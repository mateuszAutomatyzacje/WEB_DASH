import { getSql } from '@/lib/db.js';

const ALLOWED = new Set(['running', 'stopped', 'paused']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
    const name = (body?.name || 'OUTSOURCING_IT_EVERGREEM').trim();
    const status = (body?.status || '').trim();

    if (!ALLOWED.has(status)) throw new Error('invalid status');

    const sql = getSql();
    const rows = campaignId
      ? await sql`
          update campaigns
          set status = ${status}::campaign_status,
              updated_at = now()
          where id = ${campaignId}
          returning id, name, status::text as status
        `
      : await sql`
          update campaigns
          set status = ${status}::campaign_status,
              updated_at = now()
          where id = (
            select id from campaigns where name = ${name} order by created_at desc limit 1
          )
          returning id, name, status::text as status
        `;

    if (!rows.length) throw new Error('evergreen campaign not found');

    return Response.json({ ok: true, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
