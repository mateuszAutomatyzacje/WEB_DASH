import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { ensureCanSendEmailNow, getCampaignRuntimeState, getCampaignSendStats, resolveOrCreateCampaign, runCampaignGuard, triggerSmtpWebhook } from '@/lib/campaign-guard.js';

const ALLOWED = new Set(['start', 'stop', 'test', 'send_now']);
const TEST_WEBHOOK_RECIPIENT = 'mateusz.wiszniowski.biznes@gmail.com';

function buildSampleTestPayload(campaign, timestamp) {
  const subject = `[WebDash Test] ${campaign.name}`;
  const body = [
    'To jest przykladowa wiadomosc testowa z WebDash.',
    '',
    `Campaign: ${campaign.name}`,
    `Campaign ID: ${campaign.id}`,
    `Generated at: ${timestamp}`,
    '',
    'Ten test uderza w webhook smtp-send, ale nie przesuwa sekwencji kampanii.',
  ].join('\n');

  return {
    campaign_id: campaign.id,
    lead_id: null,
    lead_contact_id: null,
    campaign_lead_id: null,
    message_attempt_id: null,
    contact_attempt_no: 0,
    execution_mode: 'manual_test_webhook_sample',
    sequence_step: 'sample_test',
    to_email: TEST_WEBHOOK_RECIPIENT,
    subject,
    body,
    campaign_lead_state: 'test',
    next_run_at: null,
    webdash_test_sample: true,
  };
}

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
      ensureCanSendEmailNow();
      const samplePayload = buildSampleTestPayload(campaign, nowIso);
      const webhook = await triggerSmtpWebhook(samplePayload);

      result = {
        ok: true,
        mode: 'webhook_only_sample',
        campaign,
        sync: null,
        replied: null,
        queued: 1,
        sent: 1,
        failed: 0,
        webhook_url: webhook.webhook_url,
        webhook_response: webhook.response,
        outbox_preview: [{
          campaign_lead_id: 'sample-test',
          message_attempt_id: 'sample-test',
          to_email: samplePayload.to_email,
          send_subject: samplePayload.subject,
          send_body_preview: samplePayload.body.slice(0, 120),
          lead_id: null,
          lead_contact_id: null,
          contact_attempt_no: samplePayload.contact_attempt_no,
          step_key: samplePayload.sequence_step,
          next_run_at: null,
        }],
        results: [{
          ok: true,
          step_key: samplePayload.sequence_step,
          stopped: false,
          webhook_only: true,
          sample: true,
        }],
      };

      patch = {
        ...patch,
        last_test_send_at: nowIso,
        last_test_send_result: {
          queued: result?.queued ?? 0,
          sent: result?.sent ?? 0,
          failed: result?.failed ?? 0,
          previewed: result?.outbox_preview?.length ?? 0,
          webhook_only: true,
          sample_recipient: TEST_WEBHOOK_RECIPIENT,
          sample_subject: samplePayload.subject,
          limit,
          replied_stopped: 0,
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
