import { getSql } from '@/lib/db.js';
import { buildEditableCampaignSettings, getStoredEvergreenRunner, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

function normalizeTopLevelSettings(value) {
  return buildEditableCampaignSettings(
    value && typeof value === 'object' && !Array.isArray(value) ? value : {},
  );
}

function mergeCampaignSettings(existingSettings, incomingSettings) {
  const existing = normalizeStoredCampaignSettings(existingSettings);
  const incoming = normalizeTopLevelSettings(incomingSettings);
  const existingRunner = getStoredEvergreenRunner(existing);

  return {
    ...existing,
    ...incoming,
    evergreen_runner: existingRunner || existing?.evergreen_runner,
    send_interval_min: existing?.send_interval_min,
  };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
    const name = (body?.name || '').trim();
    const description = (body?.description || '').trim() || null;
    const status = (body?.status || 'draft').trim();
    const settings = body?.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {};

    if (!name && !campaignId) throw new Error('missing name');

    const sql = getSql();

    if (campaignId) {
      const existingRows = await sql`
        select settings
        from campaigns
        where id = ${campaignId}
        limit 1
      `;
      if (!existingRows.length) throw new Error('campaign not found');

      const mergedSettings = mergeCampaignSettings(existingRows[0]?.settings, settings);
      const rows = await sql`
        update campaigns
        set name = coalesce(nullif(${name}, ''), name),
            status = ${status}::campaign_status,
            description = ${description},
            settings = ${JSON.stringify(mergedSettings)}::jsonb,
            updated_at = now()
        where id = ${campaignId}
        returning id, name, description, status::text as status, settings, updated_at
      `;

      return Response.json({ ok: true, updated: true, campaign_id: rows[0].id, campaign: rows[0], ...rows[0] });
    }

    const existing = await sql`
      select id, settings
      from campaigns
      where name = ${name}
      order by created_at desc
      limit 1
    `;

    if (existing.length > 0) {
      const mergedSettings = mergeCampaignSettings(existing[0]?.settings, settings);
      const rows = await sql`
        update campaigns
        set status = ${status}::campaign_status,
            description = ${description},
            settings = ${JSON.stringify(mergedSettings)}::jsonb,
            updated_at = now()
        where id = ${existing[0].id}
        returning id, name, description, status::text as status, settings, updated_at
      `;

      return Response.json({ ok: true, updatedExistingByName: true, campaign_id: rows[0].id, campaign: rows[0], ...rows[0] });
    }

    const initialSettings = normalizeTopLevelSettings(settings);
    const rows = await sql`
      insert into campaigns (name, status, description, settings)
      values (${name}, ${status}::campaign_status, ${description}, ${JSON.stringify(initialSettings)}::jsonb)
      returning id, name, description, status::text as status, settings, updated_at
    `;

    return Response.json({ ok: true, created: true, campaign_id: rows[0].id, campaign: rows[0], ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
