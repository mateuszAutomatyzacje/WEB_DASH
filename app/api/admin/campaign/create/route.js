import { getSql } from '@/lib/db.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
    const name = (body?.name || '').trim();
    const description = (body?.description || '').trim() || null;
    const status = (body?.status || 'draft').trim();
    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};

    if (!name && !campaignId) throw new Error('missing name');

    const sql = getSql();

    if (campaignId) {
      const rows = await sql`
        update campaigns
        set name = coalesce(nullif(${name}, ''), name),
            status = ${status}::campaign_status,
            description = ${description},
            settings = ${JSON.stringify(settings)}::jsonb,
            updated_at = now()
        where id = ${campaignId}
        returning id, name, status::text as status
      `;
      if (!rows.length) throw new Error('campaign not found');
      return Response.json({ ok: true, updated: true, ...rows[0] });
    }

    const existing = await sql`
      select id
      from campaigns
      where name = ${name}
      order by created_at desc
      limit 1
    `;

    if (existing.length > 0) {
      const rows = await sql`
        update campaigns
        set status = ${status}::campaign_status,
            description = ${description},
            settings = ${JSON.stringify(settings)}::jsonb,
            updated_at = now()
        where id = ${existing[0].id}
        returning id, name, status::text as status
      `;
      return Response.json({ ok: true, updatedExistingByName: true, ...rows[0] });
    }

    const rows = await sql`
      insert into campaigns (name, status, description, settings)
      values (${name}, ${status}::campaign_status, ${description}, ${JSON.stringify(settings)}::jsonb)
      returning id, name, status::text as status
    `;

    return Response.json({ ok: true, created: true, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
