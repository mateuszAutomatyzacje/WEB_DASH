import { getSql } from '@/lib/db.js';

const ALLOWED = new Set(['draft', 'ready', 'running', 'paused', 'stopped', 'archived']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaign_id = body?.campaign_id;
    const status = (body?.status || '').trim();

    if (!campaign_id) throw new Error('missing campaign_id');
    if (!ALLOWED.has(status)) throw new Error('invalid status');

    const sql = getSql();
    await sql`
      update campaigns
      set status = ${status}::campaign_status,
          updated_at = now()
      where id = ${campaign_id}
    `;

    return Response.json({ ok: true, campaign_id, status });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
