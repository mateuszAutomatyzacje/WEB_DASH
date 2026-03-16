import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { getNextExpectedRunAt, getCampaignRuntimeState, resolveOrCreateCampaign, runCampaignGuard } from '@/lib/campaign-guard.js';

export async function POST(req) {
  try {
    const schedulerToken = process.env.WEBDASH_SCHEDULER_TOKEN || '';
    const authHeader = req.headers.get('authorization') || '';
    if (schedulerToken) {
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearer !== schedulerToken) {
        return new Response('unauthorized scheduler token', { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const campaignName = String(body?.campaign_name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 200);
    const dryRun = Boolean(body?.dry_run ?? false);

    const sql = getSql();
    const campaign = await resolveOrCreateCampaign(sql, {
      campaignId: body?.campaign_id || null,
      campaignName,
      source: 'webdash_cron_sync',
    });

    const settings = normalizeStoredCampaignSettings(campaign.settings);
    const runtime = getCampaignRuntimeState(settings);
    const autoSyncEnabled = body?.force_sync === true ? true : runtime.auto_sync_enabled;
    const autoSendEnabled = body?.force_send === true ? true : runtime.auto_send_enabled;
    const intervalMin = Number(body?.interval_min || runtime.sync_interval_min || settings.send_interval_min || 10);

    let sendResult = null;
    if (autoSendEnabled || dryRun) {
      sendResult = await runCampaignGuard(sql, {
        campaignId: campaign.id,
        campaignName: campaign.name,
        dryRun,
        limit,
        performSync: autoSyncEnabled,
        source: 'webdash_cron_sync',
        executionMode: dryRun ? 'cron_sync_preview' : 'cron_sync',
      });
    } else {
      sendResult = await runCampaignGuard(sql, {
        campaignId: campaign.id,
        campaignName: campaign.name,
        dryRun: true,
        limit,
        performSync: autoSyncEnabled,
        source: 'webdash_cron_sync',
        executionMode: 'cron_sync_preview',
      });
    }

    const nextExpectedRunAt = getNextExpectedRunAt(settings, intervalMin);
    const schedulerResult = {
      dry_run: dryRun,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      replied_stopped: sendResult?.replied?.stopped ?? 0,
      skipped_live_send: !autoSendEnabled && !dryRun,
      timestamp: new Date().toISOString(),
    };

    await sql`
      update public.campaigns
      set
        settings = coalesce(settings, '{}'::jsonb) || ${sql.json({
          auto_sync_enabled: autoSyncEnabled,
          auto_sync_status: autoSyncEnabled ? 'running' : 'paused',
          auto_send_enabled: autoSendEnabled,
          auto_send_status: autoSendEnabled ? 'running' : 'paused',
          sync_interval_min: intervalMin,
          last_sync_at: new Date().toISOString(),
          last_sync_ok: true,
          next_expected_run_at: nextExpectedRunAt,
          last_auto_send_at: !dryRun && autoSendEnabled ? new Date().toISOString() : runtime.last_auto_send_at,
          last_scheduler_send_at: !dryRun && autoSendEnabled ? new Date().toISOString() : (settings.last_scheduler_send_at || null),
        })}::jsonb
        || jsonb_build_object(
          'last_sync_result', ${sql.json(sendResult?.sync || {})}::jsonb,
          'last_send_result', ${sql.json(schedulerResult)}::jsonb,
          'last_scheduler_result', ${sql.json(schedulerResult)}::jsonb
        ),
        updated_at = now()
      where id = ${campaign.id}::uuid
    `;

    return Response.json({
      ok: true,
      mode: dryRun ? 'cron-preview' : (autoSendEnabled ? 'cron-sync-send' : 'cron-sync-only'),
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      auto_sync_enabled: autoSyncEnabled,
      auto_send_enabled: autoSendEnabled,
      next_expected_run_at: nextExpectedRunAt,
      sync: sendResult?.sync || null,
      replied: sendResult?.replied || null,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      skipped_live_send: !autoSendEnabled && !dryRun,
      outbox_preview: sendResult?.outbox_preview || [],
      results: sendResult?.results || [],
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
