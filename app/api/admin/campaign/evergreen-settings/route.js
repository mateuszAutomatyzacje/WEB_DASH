import { getSql } from '@/lib/db.js';
import {
  DEFAULT_EVERGREEN_NAME,
  getCampaignRunnerConfig,
  normalizeEvergreenConfig,
  toStoredEvergreenRunner,
} from '@/lib/evergreen-config.js';

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

    const config = normalizeEvergreenConfig(body, getCampaignRunnerConfig(campaign));
    const storedRunner = toStoredEvergreenRunner(config);
    const sendIntervalMin = config.sendIntervalMin;

    const rows = await sql`
      update campaigns c
      set settings = jsonb_set(
            jsonb_set(
              jsonb_set(
                case
                  when c.settings is null then '{}'::jsonb
                  when jsonb_typeof(c.settings::jsonb) = 'object' then c.settings::jsonb
                  else '{}'::jsonb
                end,
                '{evergreen_runner}',
                ${sql.json(storedRunner)}::jsonb,
                true
              ),
              '{mode}',
              '"evergreen"'::jsonb,
              true
            ),
            '{send_interval_min}',
            to_jsonb(${sendIntervalMin}::int),
            true
          ),
          updated_at = now()
      where c.id = ${campaign.id}
      returning c.id, c.name, c.description, c.status::text as status, c.settings, c.updated_at
    `;

    const updatedCampaign = rows[0];
    const updatedConfig = getCampaignRunnerConfig(updatedCampaign);

    return Response.json({
      ok: true,
      campaign: updatedCampaign,
      campaign_id: updatedCampaign.id,
      settings: updatedCampaign.settings,
      evergreen_runner: updatedCampaign.settings?.evergreen_runner || storedRunner,
      send_interval_min: updatedCampaign.settings?.send_interval_min ?? sendIntervalMin,
      runner_config: updatedConfig,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
