import { getSql } from '@/lib/db.js';

function buildRunnerPayload(cfg) {
  return {
    baseUrl: cfg.base_url,
    maxPages: cfg.max_pages,
    budgetMaxRequests: cfg.budget_max_requests,
    crawl4aiEndpoint: cfg.crawl4ai_endpoint,
    rateSeconds: Number(cfg.rate_seconds),
    jobTitle: cfg.job_title,
    city: cfg.city,
    experienceLevel: cfg.experience_level,
    testMode: cfg.test_mode,
    apolloMaxPeoplePerCompany: cfg.apollo_max_people_per_company,
    runId: null,
  };
}

export async function POST() {
  try {
    const sql = getSql();

    const rows = await sql`
      select *
      from public.scrape_settings
      where id = 'global'
      limit 1
    `;
    const cfg = rows?.[0];
    if (!cfg) throw new Error("Missing scrape_settings row id='global'");

    // WebDash default (can be overridden by env)
    const runnerWebhookUrl = process.env.JUSTJOIN_SCRAPER_WEBHOOK_URL
      || 'https://n8n-production-c340.up.railway.app/webhook/efxblr-test-trigger';

    const token = process.env.JUSTJOIN_SCRAPER_WEBHOOK_TOKEN || null;

    // basic lock: 15 minutes
    const lockMins = 15;
    const lockRows = await sql`
      update public.scrape_settings
      set locked_until = now() + (${lockMins}::text || ' minutes')::interval,
          updated_at = now()
      where id = 'global'
        and (locked_until is null or locked_until < now())
      returning locked_until
    `;

    if (lockRows.length === 0) {
      return Response.json({ ok: true, skipped: true, reason: 'locked' });
    }

    await sql`
      update public.scrape_settings
      set last_run_status = 'running',
          last_run_at = now(),
          updated_at = now()
      where id = 'global'
    `;

    const payload = buildRunnerPayload(cfg);

    const res = await fetch(runnerWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok || json?.ok === false) {
      const errMsg = json?.error || json?.message || `HTTP ${res.status}`;
      await sql`
        update public.scrape_settings
        set last_run_status = 'error',
            updated_at = now(),
            locked_until = null
        where id = 'global'
      `;
      throw new Error(`Runner webhook failed: ${errMsg}`);
    }

    const runId = json?.runId || json?.run_id || json?.id || null;

    await sql`
      update public.scrape_settings
      set last_run_id = ${runId},
          last_run_status = 'queued',
          updated_at = now(),
          locked_until = null
      where id = 'global'
    `;

    return Response.json({ ok: true, runId, status: 'queued', last_run_at: new Date().toISOString() });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
