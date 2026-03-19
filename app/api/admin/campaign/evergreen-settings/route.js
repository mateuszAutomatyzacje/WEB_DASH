import { getSql } from '@/lib/db.js';
import {
  DEFAULT_EVERGREEN_NAME,
  getCampaignRunnerConfig,
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
      select id, name, status, description, settings
      from campaigns
      where id = ${campaignId}
      limit 1
    `;
    return rows[0] || null;
  }

  const name = String(body?.campaignName || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
  const rows = await sql`
    select id, name, status, description, settings
    from campaigns
    where name = ${name}
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sql = getSql();

    const campaign = await resolveCampaign(sql, body);
    if (!campaign) throw new Error('Campaign not found');

    const existingSettings = normalizeStoredCampaignSettings(campaign.settings);
    const config = validateEvergreenRuntimeConfig(
      normalizeEvergreenConfig(body, getCampaignRunnerConfig(campaign, { strict: true }), { strict: true }),
    );
    const storedRunner = toStoredEvergreenRunner(config, { strict: true });
    const scraperIntervalMin = config.sendIntervalMin;
    const leadSyncIntervalMin = config.leadSyncIntervalMin;
    const sendEmailIntervalMin = config.sendEmailIntervalMin;
    const rawBatchLimit = body?.sendBatchLimit ?? body?.send_batch_limit ?? existingSettings.send_batch_limit ?? existingSettings.sendBatchLimit ?? 1;
    const batchValue = Number(rawBatchLimit);
    const sendBatchLimit = Number.isFinite(batchValue) ? Math.min(Math.max(Math.trunc(batchValue), 1), 200) : 1;
    const mergedSettings = {
      ...existingSettings,
      mode: 'evergreen',
      evergreen_runner: storedRunner,
      send_interval_min: scraperIntervalMin,
      lead_sync_interval_min: leadSyncIntervalMin,
      send_email_interval_min: sendEmailIntervalMin,
      send_batch_limit: sendBatchLimit,
    };
    delete mergedSettings.sync_interval_min;

    const rows = await sql`
      update campaigns c
      set settings = ${sql.json(mergedSettings)}::jsonb,
          updated_at = now()
      where c.id = ${campaign.id}
      returning c.id, c.name, c.description, c.status::text as status, c.settings, c.updated_at
    `;

    const updatedCampaign = rows[0];
    await syncScrapeSettingsFromCampaign(sql, { campaignId: updatedCampaign.id, campaignName: updatedCampaign.name });
    const updatedConfig = getCampaignRunnerConfig(updatedCampaign);

    return Response.json({
      ok: true,
      campaign: updatedCampaign,
      campaign_id: updatedCampaign.id,
      settings: updatedCampaign.settings,
      evergreen_runner: updatedCampaign.settings?.evergreen_runner || storedRunner,
      send_interval_min: updatedCampaign.settings?.send_interval_min ?? scraperIntervalMin,
      lead_sync_interval_min: updatedCampaign.settings?.lead_sync_interval_min ?? leadSyncIntervalMin,
      send_email_interval_min: updatedCampaign.settings?.send_email_interval_min ?? sendEmailIntervalMin,
      send_batch_limit: updatedCampaign.settings?.send_batch_limit ?? sendBatchLimit,
      runner_config: updatedConfig,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
