import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

const ALLOWED = new Set(['start', 'stop']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const action = String(body?.action || '').trim();
    const intervalMin = Number(body?.interval_min || 10);

    if (!ALLOWED.has(action)) throw new Error('invalid action');

    const sql = getSql();
    const existing = await sql`
      select id, name, status::text as status, settings
      from campaigns
      where id = (
        select id from campaigns where name = ${name} order by created_at desc limit 1
      )
    `;

    if (!existing.length) throw new Error('campaign not found');

    const mergedSettings = {
      ...normalizeStoredCampaignSettings(existing[0]?.settings),
      auto_sync_enabled: action === 'start',
      send_interval_min: intervalMin,
      auto_sync_status: action === 'start' ? 'running' : 'paused',
      auto_sync_updated_at: new Date().toISOString(),
    };
    delete mergedSettings.sync_interval_min;

    const rows = await sql`
      update campaigns
      set
        settings = ${sql.json(mergedSettings)}::jsonb,
        updated_at = now()
      where id = ${existing[0].id}::uuid
      returning id, name, status::text as status, settings
    `;

    return Response.json({ ok: true, action, ...rows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
