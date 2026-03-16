import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { getCampaignRuntimeState, getCampaignSendStats, resolveOrCreateCampaign, runCampaignGuard } from '@/lib/campaign-guard.js';

const ALLOWED = new Set(['start', 'stop', 'test', 'send_now']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    const campaignName = String(body?.campaign_name || body?.name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const limit = Math.min(Math.max(Number(body?.limit || 10), 1), 200);

    if (!ALLOWED.has(action)) throw new Error('invalid action');

    const sql = getSql();
    const campaign = await resolveOrCreateCampaign(sql, {
      campaignId: body?.campaign_id || null,
      campaignName,
      source: 'webdash_auto_send',
    });

    const settings = normalizeStoredCampaignSettings(campaign.settings);
    const runtime = getCampaignRuntimeState(settings);
    const nowIso = new Date().toISOString();

    let patch = {};
    let result = null;

    if (action === 'start' || action === 'stop') {
      patch = {
        auto_send_enabled: action === 'start',
        auto_send_status: action === 'start' ? 'running' : 'paused',
        auto_send_updated_at: nowIso,
      };
    }

    if (action === 'test') {
      result = await runCampaignGuard(sql, {
        campaignId: campaign.id,
        campaignName: campaign.name,
        dryRun: true,
        limit,
        performSync: runtime.auto_sync_enabled,
        source: 'webdash_test_send',
        executionMode: 'manual_test_send',
      });

      patch = {
        ...patch,
        last_test_send_at: nowIso,
        last_test_send_result: {
          queued: result?.queued ?? 0,
          previewed: result?.outbox_preview?.length ?? 0,
          limit,
          replied_stopped: result?.replied?.stopped ?? 0,
          timestamp: nowIso,
        },
      };
    }

    if (action === 'send_now') {
      result = await runCampaignGuard(sql, {
        campaignId: campaign.id,
        campaignName: campaign.name,
        dryRun: false,
        limit,
        performSync: runtime.auto_sync_enabled,
        source: 'webdash_manual_send',
        executionMode: 'manual_send',
      });

      patch = {
        ...patch,
        last_manual_send_at: nowIso,
        last_manual_send_result: {
          queued: result?.queued ?? 0,
          sent: result?.sent ?? 0,
          failed: result?.failed ?? 0,
          replied_stopped: result?.replied?.stopped ?? 0,
          limit,
          timestamp: nowIso,
        },
      };
    }

    const mergedSettings = {
      ...settings,
      ...patch,
    };

    const updatedRows = await sql`
      update public.campaigns
      set
        settings = ${sql.json(mergedSettings)}::jsonb,
        updated_at = now()
      where id = ${campaign.id}::uuid
      returning id, name, status::text as status, settings, description, updated_at, created_at
    `;

    const updatedCampaign = {
      ...updatedRows[0],
      settings: normalizeStoredCampaignSettings(updatedRows[0]?.settings),
    };
    const sendStats = await getCampaignSendStats(sql, campaign.id);
    const updatedRuntime = getCampaignRuntimeState(updatedCampaign.settings);

    return Response.json({
      ok: true,
      action,
      campaign: updatedCampaign,
      campaign_id: updatedCampaign.id,
      campaign_name: updatedCampaign.name,
      settings: updatedCampaign.settings,
      auto_send_enabled: updatedRuntime.auto_send_enabled,
      auto_send_status: updatedRuntime.auto_send_status,
      queued_now: sendStats.queued_now,
      next_due_email: sendStats.next_due_email,
      last_auto_send_at: updatedRuntime.last_auto_send_at,
      last_scheduler_result: updatedRuntime.last_scheduler_result,
      last_manual_send_at: updatedRuntime.last_manual_send_at,
      last_manual_send_result: updatedRuntime.last_manual_send_result,
      last_test_send_at: updatedRuntime.last_test_send_at,
      last_test_send_result: updatedRuntime.last_test_send_result,
      queued: result?.queued ?? sendStats.queued_now,
      sent: result?.sent ?? 0,
      failed: result?.failed ?? 0,
      outbox_preview: result?.outbox_preview || [],
      replied: result?.replied || null,
      sync: result?.sync || null,
      results: result?.results || [],
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
