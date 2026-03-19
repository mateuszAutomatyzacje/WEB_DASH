import { getSql } from '@/lib/db.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';
import {
  DEFAULT_EVERGREEN_NAME,
  buildEvergreenWebhookPayload,
  getCampaignRunnerConfig,
  getStoredEvergreenRunner,
  normalizeEvergreenConfig,
  normalizeStoredCampaignSettings,
  toStoredEvergreenRunner,
  validateEvergreenRuntimeConfig,
} from '@/lib/evergreen-config.js';
import { syncScrapeSettingsFromCampaign } from '@/lib/scrape-settings.js';

async function resolveCampaign(sql, body = {}) {
  const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
  if (campaignId) {
    const rows = await sql`
      select id, name, status, settings
      from campaigns
      where id = ${campaignId}
      limit 1
    `;
    return rows[0] || null;
  }

  const name = String(body?.campaignName || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
  const rows = await sql`
    select id, name, status, settings
    from campaigns
    where name = ${name}
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function POST(req) {
  let sql = null;
  let campaignName = DEFAULT_EVERGREEN_NAME;
  let updatedCampaign = null;
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || 'start').trim();
    const isTestMode = mode === 'test';
    sql = getSql();

    const campaign = await resolveCampaign(sql, body);
    if (!campaign) throw new Error('Campaign not found');
    campaignName = campaign.name;

    const existingSettings = normalizeStoredCampaignSettings(campaign.settings);
    const hasStoredRunner = Boolean(getStoredEvergreenRunner(campaign));
    const config = validateEvergreenRuntimeConfig(
      hasStoredRunner
        ? getCampaignRunnerConfig(campaign, { strict: true })
        : normalizeEvergreenConfig(body, getCampaignRunnerConfig(campaign, { strict: true }), { strict: true }),
    );
    const storedRunner = toStoredEvergreenRunner(config, { strict: true });
    const mergedSettings = {
      ...existingSettings,
      mode: 'evergreen',
      evergreen_runner: storedRunner,
      send_interval_min: config.sendIntervalMin,
      lead_sync_interval_min: config.leadSyncIntervalMin,
      send_email_interval_min: config.sendEmailIntervalMin,
    };
    delete mergedSettings.sync_interval_min;

    const rows = await sql`
      update campaigns
      set status = case when ${isTestMode} then status else 'running'::campaign_status end,
          settings = ${sql.json(mergedSettings)}::jsonb,
          updated_at = now()
      where id = ${campaign.id}
      returning id, name, status::text as status, settings, updated_at
    `;

    updatedCampaign = rows[0];
    await syncScrapeSettingsFromCampaign(sql, { campaignId: updatedCampaign.id, campaignName: updatedCampaign.name });
    const finalConfig = getCampaignRunnerConfig(updatedCampaign);
    const payload = buildEvergreenWebhookPayload(finalConfig, {
      campaignId: updatedCampaign.id,
      campaignName: updatedCampaign.name,
      mode,
    });

    const res = await fetch(finalConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(json?.error || json?.message || text || `HTTP ${res.status}`);

    await logApplicationEventSafe(sql, {
      level: 'success',
      scope: 'api',
      source: 'start_evergreen',
      eventType: isTestMode ? 'evergreen_test_triggered' : 'evergreen_started',
      message: `${isTestMode ? 'Evergreen test trigger sent' : 'Evergreen started'} for ${updatedCampaign.name}.`,
      campaignId: updatedCampaign.id,
      campaignName: updatedCampaign.name,
      details: {
        mode,
        webhook_url: finalConfig.webhookUrl,
        send_interval_min: config.sendIntervalMin,
        lead_sync_interval_min: config.leadSyncIntervalMin,
        send_email_interval_min: config.sendEmailIntervalMin,
      },
    });

    return Response.json({
      ok: true,
      mode,
      campaign_id: updatedCampaign.id,
      campaign_name: updatedCampaign.name,
      status: updatedCampaign.status,
      display_status: isTestMode ? 'test' : updatedCampaign.status,
      campaign: updatedCampaign,
      settings: updatedCampaign.settings,
      webhook_url: finalConfig.webhookUrl,
      request_payload: payload,
      webhook_response: json,
    });
  } catch (e) {
    if (sql) {
      await logApplicationEventSafe(sql, {
        level: 'error',
        scope: 'api',
        source: 'start_evergreen',
        eventType: 'evergreen_start_failed',
        message: `Failed to start evergreen for ${updatedCampaign?.name || campaignName}: ${String(e?.message || e)}`,
        campaignId: updatedCampaign?.id || null,
        campaignName: updatedCampaign?.name || campaignName || null,
        details: {
          error: String(e?.message || e),
        },
      });
    }
    return new Response(String(e?.message || e), { status: 400 });
  }
}
