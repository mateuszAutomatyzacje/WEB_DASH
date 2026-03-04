import { getSql } from '@/lib/db.js';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const name = (url.searchParams.get('name') || 'AI_KANCELARIE_EVERGREEN').trim();

    const sql = getSql();
    const rows = await sql`
      select id, name, status::text as status, updated_at
      from campaigns
      where name = ${name}
      order by created_at desc
      limit 1
    `;

    if (!rows.length) return Response.json({ ok: false, found: false, name });
    return Response.json({ ok: true, found: true, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
