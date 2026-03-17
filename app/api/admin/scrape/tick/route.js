import { getSql } from '@/lib/db.js';
import { ensureScrapeSettings } from '@/lib/scrape-settings.js';

// This endpoint is meant to be pinged by an external cron (Railway/Render/UptimeRobot)
// every hour (or every few minutes). It checks scrape_settings.running and triggers a run.

export async function POST() {
  try {
    const sql = getSql();

    const { settings: cfg } = await ensureScrapeSettings(sql);
    if (!cfg) throw new Error("Missing scrape_settings row id='global'");

    if (!cfg.running) {
      return Response.json({ ok: true, skipped: true, reason: 'running=false' });
    }

    // Call internal run endpoint to reuse locking + update logic.
    // Use absolute URL if provided (needed in some serverless environments).
    const base = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    if (!base) return new Response('Missing PUBLIC_BASE_URL for tick -> run call', { status: 400 });
    const url = `${base}/api/admin/scrape/run`;

    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.message || text || `HTTP ${res.status}`);

    return Response.json({ ok: true, tick: true, run: json });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
