import { getSql } from '@/lib/db.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body?.name || '').trim();
    const description = (body?.description || '').trim() || null;
    const status = (body?.status || 'draft').trim();
    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};

    if (!name) throw new Error('missing name');

    const sql = getSql();
    const rows = await sql`
      insert into campaigns (name, status, description, settings)
      values (${name}, ${status}::campaign_status, ${description}, ${JSON.stringify(settings)}::jsonb)
      returning id, name, status::text as status
    `;

    return Response.json({ ok: true, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
