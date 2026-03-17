import { getSql } from '@/lib/db.js';
import { ensureScrapeSettings, getScrapeSettings } from '@/lib/scrape-settings.js';

function toInt(v, { min = 1, max = 100000 } = {}) {
  if (v === null || typeof v === 'undefined' || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function toNum(v, { min = 0, max = 3600 } = {}) {
  if (v === null || typeof v === 'undefined' || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function hasProp(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

export async function GET() {
  try {
    const sql = getSql();
    let cfg = await getScrapeSettings(sql);
    if (!cfg) {
      try {
        const seeded = await ensureScrapeSettings(sql);
        cfg = seeded.settings;
      } catch (e) {
        return Response.json({ ok: true, settings: null, warning: String(e?.message || e) });
      }
    }
    return Response.json({ ok: true, settings: cfg || null });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}

export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sql = getSql();
    const existing = await getScrapeSettings(sql);

    const running = hasProp(body, 'running') ? Boolean(body?.running) : Boolean(existing?.running);

    const baseUrl = hasProp(body, 'baseUrl') ? toTrimmedString(body?.baseUrl) : (existing?.base_url ?? '');
    if (!baseUrl) throw new Error('Missing baseUrl');

    const crawl4aiEndpoint = hasProp(body, 'crawl4aiEndpoint')
      ? toTrimmedString(body?.crawl4aiEndpoint)
      : (existing?.crawl4ai_endpoint ?? '');
    if (!crawl4aiEndpoint) throw new Error('Missing crawl4aiEndpoint');

    const maxPages = hasProp(body, 'maxPages')
      ? toInt(body?.maxPages, { min: 1, max: 200 })
      : (existing?.max_pages ?? null);
    if (maxPages === null) throw new Error('Missing maxPages');

    const budgetMaxRequests = hasProp(body, 'budgetMaxRequests')
      ? toInt(body?.budgetMaxRequests, { min: 1, max: 100000 })
      : (existing?.budget_max_requests ?? null);
    if (budgetMaxRequests === null) throw new Error('Missing budgetMaxRequests');

    const rateSeconds = hasProp(body, 'rateSeconds')
      ? toNum(body?.rateSeconds, { min: 0, max: 60 })
      : (existing?.rate_seconds ?? null);
    if (rateSeconds === null) throw new Error('Missing rateSeconds');

    const jobTitle = hasProp(body, 'jobTitle')
      ? (body?.jobTitle === null || body?.jobTitle === '' ? null : String(body?.jobTitle))
      : (existing?.job_title ?? null);
    const city = hasProp(body, 'city')
      ? (body?.city === null || body?.city === '' ? null : String(body?.city))
      : (existing?.city ?? null);
    const experienceLevel = hasProp(body, 'experienceLevel')
      ? (body?.experienceLevel === null || body?.experienceLevel === '' ? null : String(body?.experienceLevel))
      : (existing?.experience_level ?? null);
    const testMode = hasProp(body, 'testMode') ? Boolean(body?.testMode) : Boolean(existing?.test_mode);
    const apolloMax = hasProp(body, 'apolloMaxPeoplePerCompany')
      ? (
        body?.apolloMaxPeoplePerCompany === null
          || body?.apolloMaxPeoplePerCompany === ''
          || typeof body?.apolloMaxPeoplePerCompany === 'undefined'
          ? null
          : toInt(body?.apolloMaxPeoplePerCompany, { min: 1, max: 10000 })
      )
      : (typeof existing?.apollo_max_people_per_company === 'undefined' ? null : existing?.apollo_max_people_per_company);

    const rows = await sql`
      insert into public.scrape_settings (
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
        updated_at
      )
      values (
        'global',
        ${running},
        ${baseUrl},
        ${maxPages},
        ${budgetMaxRequests},
        ${crawl4aiEndpoint},
        ${rateSeconds},
        ${jobTitle},
        ${city},
        ${experienceLevel},
        ${testMode},
        ${apolloMax},
        now()
      )
      on conflict (id) do update
      set
        running = excluded.running,
        base_url = excluded.base_url,
        max_pages = excluded.max_pages,
        budget_max_requests = excluded.budget_max_requests,
        crawl4ai_endpoint = excluded.crawl4ai_endpoint,
        rate_seconds = excluded.rate_seconds,
        job_title = excluded.job_title,
        city = excluded.city,
        experience_level = excluded.experience_level,
        test_mode = excluded.test_mode,
        apollo_max_people_per_company = excluded.apollo_max_people_per_company,
        updated_at = now()
      returning
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
    `;

    return Response.json({ ok: true, settings: rows?.[0] || null });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
