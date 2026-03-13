import { getSql } from '@/lib/db.js';

const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';

function normalize(body = {}) {
  return {
    webhook_url: String(body?.webhookUrl || 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger').trim(),
    base_url: String(body?.baseUrl || 'https://justjoin.it/job-offers').trim(),
    max_pages: Math.max(1, Number(body?.maxPages || 3)),
    budget_max_requests: Math.max(1, Number(body?.budgetMaxRequests || 120)),
    crawl4ai_endpoint: String(body?.crawl4aiEndpoint || 'https://crawl4ai-production-0915.up.railway.app/crawl').trim(),
    rate_seconds: Math.max(0, Number(body?.rateSeconds || 1)),
    job_title: body?.jobTitle ? String(body.jobTitle) : '',
    city: body?.city ? String(body.city) : 'Poland',
    experience_level: body?.experienceLevel ? String(body.experienceLevel) : '',
    test_mode: Boolean(body?.testMode),
    apollo_api_key: body?.apolloApiKey ? String(body.apolloApiKey) : '',
    apollo_max_people_per_company: Math.max(1, Number(body?.apolloMaxPeoplePerCompany || 3)),
    run_id: body?.runId ? String(body.runId) : '',
    crawl4ai_health_path: String(body?.crawl4aiHealthPath || '/health').trim(),
  };
}

export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.campaignName || DEFAULT_NAME).trim() || DEFAULT_NAME;
    const config = normalize(body);
    const sql = getSql();

    const rows = await sql`
      update campaigns
      set settings = jsonb_set(
            case
              when settings is null then '{}'::jsonb
              when jsonb_typeof(settings::jsonb) = 'object' then settings::jsonb
              else '{}'::jsonb
            end,
            '{evergreen_runner}',
            ${JSON.stringify(config)}::jsonb,
            true
          ),
          updated_at = now()
      where name = ${name}
      returning id, name, status, settings
    `;

    if (rows.length === 0) throw new Error(`Campaign not found: ${name}`);

    return Response.json({ ok: true, campaign: rows[0], evergreen_runner: rows[0].settings?.evergreen_runner || config });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
