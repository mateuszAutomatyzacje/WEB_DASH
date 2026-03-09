import { getSql } from '@/lib/db.js';

function toInt(v, { min = 1, max = 100000 } = {}) {
  if (v === null || typeof v === 'undefined') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function toNum(v, { min = 0, max = 3600 } = {}) {
  if (v === null || typeof v === 'undefined') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`
      select
        id,
        running,
        base_url,
        max_pages,
        budget_max_requests,
        crawl4ai_endpoint,
        rate_seconds,
        job_title,
        city,
        experience_level,
        test_mode,
        apollo_max_people_per_company,
        last_run_id,
        last_run_status,
        last_run_at,
        locked_until,
        updated_at
      from public.scrape_settings
      where id = 'global'
      limit 1
    `;
    return Response.json({ ok: true, settings: rows?.[0] || null });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}

export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const running = Boolean(body?.running);
    const baseUrl = String(body?.baseUrl || '').trim() || 'https://justjoin.it/job-offers';
    const crawl4aiEndpoint = String(body?.crawl4aiEndpoint || '').trim();

    if (!crawl4aiEndpoint) throw new Error('Missing crawl4aiEndpoint');

    const maxPages = toInt(body?.maxPages, { min: 1, max: 200 }) ?? 3;
    const budgetMaxRequests = toInt(body?.budgetMaxRequests, { min: 1, max: 100000 }) ?? 120;
    const rateSeconds = toNum(body?.rateSeconds, { min: 0, max: 60 }) ?? 1;

    const jobTitle = body?.jobTitle === null || body?.jobTitle === '' ? null : String(body?.jobTitle);
    const city = body?.city === null || body?.city === '' ? null : String(body?.city);
    const experienceLevel = body?.experienceLevel === null || body?.experienceLevel === '' ? null : String(body?.experienceLevel);
    const testMode = Boolean(body?.testMode);
    const apolloMax = body?.apolloMaxPeoplePerCompany === null || body?.apolloMaxPeoplePerCompany === '' || typeof body?.apolloMaxPeoplePerCompany === 'undefined'
      ? null
      : toInt(body?.apolloMaxPeoplePerCompany, { min: 1, max: 10000 });

    const sql = getSql();

    await sql`
      update public.scrape_settings
      set
        running = ${running},
        base_url = ${baseUrl},
        max_pages = ${maxPages},
        budget_max_requests = ${budgetMaxRequests},
        crawl4ai_endpoint = ${crawl4aiEndpoint},
        rate_seconds = ${rateSeconds},
        job_title = ${jobTitle},
        city = ${city},
        experience_level = ${experienceLevel},
        test_mode = ${testMode},
        apollo_max_people_per_company = ${apolloMax},
        updated_at = now()
      where id = 'global'
    `;

    const rows = await sql`
      select
        id,
        running,
        base_url,
        max_pages,
        budget_max_requests,
        crawl4ai_endpoint,
        rate_seconds,
        job_title,
        city,
        experience_level,
        test_mode,
        apollo_max_people_per_company,
        last_run_id,
        last_run_status,
        last_run_at,
        locked_until,
        updated_at
      from public.scrape_settings
      where id = 'global'
      limit 1
    `;

    return Response.json({ ok: true, settings: rows?.[0] || null });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
