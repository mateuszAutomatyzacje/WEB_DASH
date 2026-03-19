import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
    const name = String(body?.name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const description = 'Kampania ciągła dla nowych leadów';
    const settings = {
      mode: 'evergreen',
      send_interval_min: 30,
      lead_sync_interval_min: 30,
      send_email_interval_min: 5,
      auto_enqueue: true,
      auto_sync_enabled: true,
      auto_sync_status: 'running',
    };

    const sql = getSql();

    let resolvedId = campaignId;
    if (!resolvedId) {
      const existing = await sql`
        select id
        from campaigns
        where name = ${name}
        order by created_at desc
        limit 1
      `;
      if (existing.length > 0) resolvedId = existing[0].id;
    }

    if (resolvedId) {
      const existingRows = await sql`
        select settings
        from campaigns
        where id = ${resolvedId}
        limit 1
      `;
      if (!existingRows.length) throw new Error('campaign not found');

      const mergedSettings = {
        ...normalizeStoredCampaignSettings(existingRows[0]?.settings),
        ...settings,
      };
      delete mergedSettings.sync_interval_min;

      const rows = await sql`
        update campaigns
        set status = 'running',
            description = ${description},
            settings = ${sql.json(mergedSettings)}::jsonb,
            updated_at = now()
        where id = ${resolvedId}
        returning id, name, status::text as status
      `;
      if (!rows.length) throw new Error('campaign not found');
      return Response.json({ ok: true, campaign_id: rows[0].id, name: rows[0].name, status: rows[0].status });
    }

    const created = await sql`
      insert into campaigns (name, status, description, settings)
      values (${name}, 'running', ${description}, ${JSON.stringify(settings)}::jsonb)
      returning id, name, status::text as status
    `;

    return Response.json({ ok: true, campaign_id: created[0].id, name: created[0].name, status: created[0].status });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
