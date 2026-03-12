import { getSql } from '@/lib/db.js';

const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';
const ALLOWED = new Set(['start', 'stop']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
    const action = String(body?.action || '').trim();
    const intervalMin = Number(body?.interval_min || 10);

    if (!ALLOWED.has(action)) throw new Error('invalid action');

    const sql = getSql();
    const rows = await sql`
      update campaigns
      set
        status = ${action === 'start' ? 'running' : 'paused'}::campaign_status,
        settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify({
          auto_sync_enabled: action === 'start',
          sync_interval_min: intervalMin,
          auto_sync_status: action === 'start' ? 'running' : 'paused',
          auto_sync_updated_at: new Date().toISOString(),
        })}::jsonb,
        updated_at = now()
      where id = (
        select id from campaigns where name = ${name} order by created_at desc limit 1
      )
      returning id, name, status::text as status, settings
    `;

    if (!rows.length) throw new Error('campaign not found');
    return Response.json({ ok: true, action, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
