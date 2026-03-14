import { getSql } from '@/lib/db.js';

const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';

function normalize(body = {}, stored = {}) {
  const webhookUrl = String(body?.webhookUrl ?? stored?.webhook_url ?? 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger').trim();
  return {
    webhook_url: webhookUrl,
    base_url: String(body?.baseUrl ?? stored?.base_url ?? 'https://justjoin.it/job-offers').trim(),
    max_pages: Math.max(1, Number(body?.maxPages ?? stored?.max_pages ?? 3)),
    budget_max_requests: Math.max(1, Number(body?.budgetMaxRequests ?? stored?.budget_max_requests ?? 120)),
    crawl4ai_endpoint: String(body?.crawl4aiEndpoint ?? stored?.crawl4ai_endpoint ?? 'https://crawl4ai-production-0915.up.railway.app/crawl').trim(),
    rate_seconds: Math.max(0, Number(body?.rateSeconds ?? stored?.rate_seconds ?? 1)),
    job_title: String(body?.jobTitle ?? stored?.job_title ?? ''),
    city: String(body?.city ?? stored?.city ?? 'Poland'),
    experience_level: String(body?.experienceLevel ?? stored?.experience_level ?? ''),
    test_mode: Boolean(typeof body?.testMode === 'undefined' ? stored?.test_mode : body?.testMode),
    apollo_api_key: String(body?.apolloApiKey ?? stored?.apollo_api_key ?? ''),
    apollo_max_people_per_company: Math.max(1, Number(body?.apolloMaxPeoplePerCompany ?? stored?.apollo_max_people_per_company ?? 3)),
    run_id: String(body?.runId ?? stored?.run_id ?? ''),
    crawl4ai_health_path: String(body?.crawl4aiHealthPath ?? stored?.crawl4ai_health_path ?? '/health').trim(),
  };
}

async function resolveCampaign(sql, body = {}) {
  const campaignId = String(body?.campaign_id || body?.campaignId || '').trim();
  if (campaignId) {
    const rows = await sql`
      select id, name, status, description, settings
      from campaigns
      where id = ${campaignId}
      limit 1
    `;
    return rows[0] || null;
  }

  const name = String(body?.campaignName || DEFAULT_NAME).trim() || DEFAULT_NAME;
  const rows = await sql`
    select id, name, status, description, settings
    from campaigns
    where name = ${name}
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sql = getSql();

    const campaign = await resolveCampaign(sql, body);
    if (!campaign) throw new Error(`Campaign not found`);

    const storedRunner = campaign?.settings?.evergreen_runner || {};
    const config = normalize(body, storedRunner);
    const sendIntervalMin = [5, 10, 15].includes(Number(body?.sendIntervalMin))
      ? Number(body.sendIntervalMin)
      : Number(campaign?.settings?.send_interval_min || 5);

    const rows = await sql`
      update campaigns c
      set settings = jsonb_set(
            jsonb_set(
              jsonb_set(
                case
                  when c.settings is null then '{}'::jsonb
                  when jsonb_typeof(c.settings::jsonb) = 'object' then c.settings::jsonb
                  else '{}'::jsonb
                end,
                '{evergreen_runner}',
                ${JSON.stringify(config)}::jsonb,
                true
              ),
              '{mode}',
              '"evergreen"'::jsonb,
              true
            ),
            '{send_interval_min}',
            to_jsonb(${sendIntervalMin}::int),
            true
          ),
          updated_at = now()
      where c.id = ${campaign.id}
      returning c.id, c.name, c.description, c.status::text as status, c.settings, c.updated_at
    `;

    return Response.json({
      ok: true,
      campaign: rows[0],
      campaign_id: rows[0].id,
      evergreen_runner: rows[0].settings?.evergreen_runner || config,
      send_interval_min: rows[0].settings?.send_interval_min ?? sendIntervalMin,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
