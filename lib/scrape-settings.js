import { getStoredEvergreenRunner, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function toNullableString(value) {
  const str = toTrimmedString(value);
  return str ? str : null;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function requireBool(value, label) {
  const parsed = toBool(value);
  if (parsed === null) throw new Error(`Missing ${label} in evergreen_runner`);
  return parsed;
}

function requireText(value, label) {
  const str = toTrimmedString(value);
  if (!str) throw new Error(`Missing ${label} in evergreen_runner`);
  return str;
}

function requireInt(value, label, { min = 1, max = 100000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Missing ${label} in evergreen_runner`);
  const int = Math.trunc(numeric);
  return Math.max(min, Math.min(max, int));
}

function requireNum(value, label, { min = 0, max = 3600 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Missing ${label} in evergreen_runner`);
  return Math.max(min, Math.min(max, numeric));
}

function toNullableInt(value, { min = 1, max = 100000 } = {}) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const int = Math.trunc(numeric);
  return Math.max(min, Math.min(max, int));
}

function toIntervalMin(value, { min = 1, max = 1440 } = {}) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(Math.trunc(numeric), max));
}

async function loadRunnerCampaign(sql, campaignName, campaignId = null) {
  let rows = [];

  if (campaignId) {
    rows = await sql`
      select id, name, status::text as status, settings
      from public.campaigns
      where id = ${campaignId}::uuid
      limit 1
    `;
  }

  if (campaignName) {
    rows = await sql`
      select id, name, status::text as status, settings
      from public.campaigns
      where name = ${campaignName}
      order by created_at desc
      limit 1
    `;
  }

  if (rows.length === 0) {
    rows = await sql`
      select id, name, status::text as status, settings
      from public.campaigns
      where settings ? 'evergreen_runner'
      order by created_at desc
      limit 1
    `;
  }

  if (rows.length === 0) {
    rows = await sql`
      select id, name, status::text as status, settings
      from public.campaigns
      where coalesce(settings->>'mode', '') = 'evergreen'
      order by created_at desc
      limit 1
    `;
  }

  return rows[0] || null;
}

function resolveCampaignRunner(campaign) {
  if (!campaign) return { campaign: null, settings: null, runner: null };

  const settings = normalizeStoredCampaignSettings(campaign.settings);
  const runner = getStoredEvergreenRunner(settings) || settings?.evergreen_runner;

  return {
    campaign,
    settings,
    runner: runner && typeof runner === 'object' ? runner : null,
  };
}

export async function getScrapeSettings(sql) {
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

  return rows?.[0] || null;
}

export async function getScrapeIntervalMin(sql, { campaignName = null } = {}) {
  const resolved = resolveCampaignRunner(await loadRunnerCampaign(sql, campaignName));
  if (!resolved.campaign) return { intervalMin: null, source: null, campaign: null };

  const raw = typeof resolved.settings?.send_interval_min !== 'undefined'
    ? resolved.settings?.send_interval_min
    : (
      typeof resolved.settings?.lead_sync_interval_min !== 'undefined'
        ? resolved.settings?.lead_sync_interval_min
        : resolved.settings?.sync_interval_min
    );

  const intervalMin = toIntervalMin(raw, { min: 1, max: 1440 });
  const source = typeof resolved.settings?.send_interval_min !== 'undefined'
    ? 'send_interval_min'
    : (
      typeof resolved.settings?.lead_sync_interval_min !== 'undefined'
        ? 'lead_sync_interval_min'
        : 'sync_interval_min'
    );

  return {
    intervalMin,
    source: intervalMin ? source : null,
    campaign: resolved.campaign.name || null,
  };
}

export async function getScrapeWebhookUrl(sql, { campaignName = null } = {}) {
  const resolved = resolveCampaignRunner(await loadRunnerCampaign(sql, campaignName));
  const webhookUrl = toTrimmedString(
    resolved.runner?.webhook_url ?? resolved.runner?.webhookUrl,
  );

  return {
    webhookUrl: webhookUrl || null,
    source: webhookUrl ? 'campaign.evergreen_runner.webhook_url' : null,
    campaign: resolved.campaign?.name || null,
  };
}

export async function ensureScrapeSettings(sql, { campaignName = null } = {}) {
  const existing = await getScrapeSettings(sql);
  if (existing) return { settings: existing, created: false };

  const synced = await syncScrapeSettingsFromCampaign(sql, { campaignName }).catch(() => null);
  if (synced?.settings) return { settings: synced.settings, created: synced.created, source_campaign: synced.source_campaign };

  const resolved = resolveCampaignRunner(await loadRunnerCampaign(sql, campaignName));
  const campaign = resolved.campaign;
  if (!campaign) {
    throw new Error('Missing scrape_settings row and no campaign with evergreen_runner config');
  }

  const runner = resolved.runner;
  if (!runner || typeof runner !== 'object') {
    throw new Error('Missing evergreen_runner config to seed scrape_settings');
  }

  const baseUrl = requireText(runner.base_url, 'evergreen_runner.base_url');
  const crawl4aiEndpoint = requireText(runner.crawl4ai_endpoint, 'evergreen_runner.crawl4ai_endpoint');
  const maxPages = requireInt(runner.max_pages, 'evergreen_runner.max_pages', { min: 1, max: 200 });
  const budgetMaxRequests = requireInt(runner.budget_max_requests, 'evergreen_runner.budget_max_requests', { min: 1, max: 100000 });
  const rateSeconds = requireNum(runner.rate_seconds, 'evergreen_runner.rate_seconds', { min: 0, max: 3600 });
  const testMode = requireBool(runner.test_mode, 'evergreen_runner.test_mode');
  const jobTitle = toNullableString(runner.job_title);
  const city = toNullableString(runner.city);
  const experienceLevel = toNullableString(runner.experience_level);
  const apolloMaxPeople = toNullableInt(runner.apollo_max_people_per_company, { min: 1, max: 10000 });
  const running = String(campaign.status || '') === 'running';

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
      ${apolloMaxPeople},
      now()
    )
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

  return { settings: rows[0] || null, created: true, source_campaign: campaign.name || null };
}

export async function syncScrapeSettingsFromCampaign(sql, { campaignId = null, campaignName = null } = {}) {
  const existing = await getScrapeSettings(sql);
  const resolved = resolveCampaignRunner(await loadRunnerCampaign(sql, campaignName, campaignId));
  const campaign = resolved.campaign;

  if (!campaign) {
    return { settings: existing, created: false, synced: false, source_campaign: null };
  }

  const runner = resolved.runner;
  if (!runner || typeof runner !== 'object') {
    return { settings: existing, created: false, synced: false, source_campaign: campaign.name || null };
  }

  const baseUrl = requireText(runner.base_url, 'evergreen_runner.base_url');
  const crawl4aiEndpoint = requireText(runner.crawl4ai_endpoint, 'evergreen_runner.crawl4ai_endpoint');
  const maxPages = requireInt(runner.max_pages, 'evergreen_runner.max_pages', { min: 1, max: 200 });
  const budgetMaxRequests = requireInt(runner.budget_max_requests, 'evergreen_runner.budget_max_requests', { min: 1, max: 100000 });
  const rateSeconds = requireNum(runner.rate_seconds, 'evergreen_runner.rate_seconds', { min: 0, max: 3600 });
  const testMode = requireBool(runner.test_mode, 'evergreen_runner.test_mode');
  const jobTitle = toNullableString(runner.job_title);
  const city = toNullableString(runner.city);
  const experienceLevel = toNullableString(runner.experience_level);
  const apolloMaxPeople = toNullableInt(runner.apollo_max_people_per_company, { min: 1, max: 10000 });
  const running = String(campaign.status || '') === 'running';

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
      ${apolloMaxPeople},
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

  return {
    settings: rows[0] || null,
    created: !existing,
    synced: true,
    source_campaign: campaign.name || null,
  };
}
