import { getSql } from '@/lib/db.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';
import { DEFAULT_EVERGREEN_NAME, SEND_INTERVAL_OPTIONS, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

const ALLOWED = new Set(['start', 'stop']);

function resolveIntervalMin(raw, fallback = 30) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return SEND_INTERVAL_OPTIONS.includes(numeric) ? numeric : fallback;
}

export async function POST(req) {
  let sql = null;
  let name = DEFAULT_EVERGREEN_NAME;
  let action = '';
  try {
    const body = await req.json().catch(() => ({}));
    name = String(body?.name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    action = String(body?.action || '').trim();
    const intervalMin = resolveIntervalMin(body?.interval_min, 30);

    if (!ALLOWED.has(action)) throw new Error('invalid action');

    sql = getSql();
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
      lead_sync_interval_min: intervalMin,
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

    await logApplicationEventSafe(sql, {
      level: 'info',
      scope: 'api',
      source: 'webdash_auto_sync',
      eventType: 'auto_sync_toggled',
      message: `Auto lead sync ${action === 'start' ? 'enabled' : 'paused'} for ${rows[0].name}.`,
      campaignId: rows[0].id,
      campaignName: rows[0].name,
      details: {
        action,
        lead_sync_interval_min: intervalMin,
      },
    });

    return Response.json({ ok: true, action, ...rows[0] });
  } catch (e) {
    if (sql) {
      await logApplicationEventSafe(sql, {
        level: 'error',
        scope: 'api',
        source: 'webdash_auto_sync',
        eventType: 'auto_sync_action_failed',
        message: `Auto-sync action ${action || '-'} failed for ${name}: ${String(e?.message || e)}`,
        campaignName: name,
        details: {
          action: action || null,
          error: String(e?.message || e),
        },
      });
    }
    return new Response(String(e?.message || e), { status: 400 });
  }
}
