import { getSql } from '@/lib/db.js';

const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';
const DEFAULT_WEBHOOK = 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger';

function normalize(body = {}, stored = {}) {
  return {
    webhookUrl: String(body?.webhookUrl || stored?.webhook_url || DEFAULT_WEBHOOK).trim(),
    baseUrl: String(body?.baseUrl || stored?.base_url || 'https://justjoin.it/job-offers').trim(),
    maxPages: Math.max(1, Number(body?.maxPages || stored?.max_pages || 3)),
    budgetMaxRequests: Math.max(1, Number(body?.budgetMaxRequests || stored?.budget_max_requests || 120)),
    crawl4aiEndpoint: String(body?.crawl4aiEndpoint || stored?.crawl4ai_endpoint || 'https://crawl4ai-production-0915.up.railway.app/crawl').trim(),
    rateSeconds: Math.max(0, Number(body?.rateSeconds || stored?.rate_seconds || 1)),
    jobTitle: body?.jobTitle ?? stored?.job_title ?? '',
    city: body?.city ?? stored?.city ?? 'Poland',
    experienceLevel: body?.experienceLevel ?? stored?.experience_level ?? '',
    testMode: Boolean(typeof body?.testMode === 'undefined' ? stored?.test_mode : body?.testMode),
    apolloApiKey: body?.apolloApiKey ?? stored?.apollo_api_key ?? '',
    apolloMaxPeoplePerCompany: Math.max(1, Number(body?.apolloMaxPeoplePerCompany || stored?.apollo_max_people_per_company || 3)),
    runId: body?.runId ?? stored?.run_id ?? '',
    crawl4aiHealthPath: String(body?.crawl4aiHealthPath || stored?.crawl4ai_health_path || '/health').trim(),
  };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.campaignName || DEFAULT_NAME).trim() || DEFAULT_NAME;
    const mode = String(body?.mode || 'start').trim();
    const sql = getSql();

    const found = await sql`
      select id, name, status, settings
      from campaigns
      where name = ${name}
      order by created_at desc
      limit 1
    `;
    if (found.length === 0) throw new Error(`Campaign not found: ${name}`);

    const campaign = found[0];
    const stored = campaign?.settings?.evergreen_runner || {};
    const cfg = normalize(body, stored);

    await sql`
      update campaigns
      set status = 'running',
          settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{evergreen_runner}', ${JSON.stringify({
            webhook_url: cfg.webhookUrl,
            base_url: cfg.baseUrl,
            max_pages: cfg.maxPages,
            budget_max_requests: cfg.budgetMaxRequests,
            crawl4ai_endpoint: cfg.crawl4aiEndpoint,
            rate_seconds: cfg.rateSeconds,
            job_title: cfg.jobTitle,
            city: cfg.city,
            experience_level: cfg.experienceLevel,
            test_mode: cfg.testMode,
            apollo_api_key: cfg.apolloApiKey,
            apollo_max_people_per_company: cfg.apolloMaxPeoplePerCompany,
            run_id: cfg.runId,
            crawl4ai_health_path: cfg.crawl4aiHealthPath,
          })}::jsonb, true),
          updated_at = now()
      where id = ${campaign.id}
    `;

    const payload = {
      baseUrl: cfg.baseUrl,
      maxPages: cfg.maxPages,
      budgetMaxRequests: cfg.budgetMaxRequests,
      crawl4aiEndpoint: cfg.crawl4aiEndpoint,
      rateSeconds: cfg.rateSeconds,
      jobTitle: cfg.jobTitle,
      city: cfg.city,
      experienceLevel: cfg.experienceLevel,
      testMode: mode === 'test' ? true : cfg.testMode,
      apolloApiKey: cfg.apolloApiKey,
      apolloMaxPeoplePerCompany: cfg.apolloMaxPeoplePerCompany,
      runId: cfg.runId || null,
      crawl4aiHealthPath: cfg.crawl4aiHealthPath,
      campaignName: name,
      triggerMode: mode,
    };

    const res = await fetch(cfg.webhookUrl || DEFAULT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(json?.error || json?.message || text || `HTTP ${res.status}`);

    return Response.json({
      ok: true,
      mode,
      campaign_id: campaign.id,
      campaign_name: name,
      status: 'running',
      webhook_url: cfg.webhookUrl,
      request_payload: payload,
      webhook_response: json,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
