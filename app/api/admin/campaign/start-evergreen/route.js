import { getSql } from '@/lib/db.js';
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
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || 'start').trim();
    const isTestMode = mode === 'test';
    const sql = getSql();

    const campaign = await resolveCampaign(sql, body);
    if (!campaign) throw new Error('Campaign not found');

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

    const updatedCampaign = rows[0];
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
    return new Response(String(e?.message || e), { status: 400 });
  }
}
