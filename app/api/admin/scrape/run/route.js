import { getSql } from '@/lib/db.js';
import { ensureScrapeSettings, getScrapeWebhookUrl } from '@/lib/scrape-settings.js';

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

    const { settings: cfg } = await ensureScrapeSettings(sql);
    if (!cfg) throw new Error("Missing scrape_settings row id='global'");

    const resolvedWebhook = await getScrapeWebhookUrl(sql);
    const runnerWebhookUrl = resolvedWebhook.webhookUrl || String(process.env.JUSTJOIN_SCRAPER_WEBHOOK_URL || '').trim();
    if (!runnerWebhookUrl) {
      throw new Error('Missing evergreen_runner.webhook_url and JUSTJOIN_SCRAPER_WEBHOOK_URL');
    }

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
