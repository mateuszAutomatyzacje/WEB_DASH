export const DEFAULT_EVERGREEN_NAME = 'OUTSOURCING_IT_EVERGREEM';
export const SEND_INTERVAL_OPTIONS = [5, 10, 15, 30, 60];
export const DEFAULT_SCRAPER_INTERVAL_MIN = 30;
export const DEFAULT_LEAD_SYNC_INTERVAL_MIN = 30;
export const DEFAULT_SEND_EMAIL_INTERVAL_MIN = 5;

export const DEFAULT_EVERGREEN_SETTINGS = {
  mode: 'evergreen',
  auto_enqueue: true,
  auto_sync_enabled: true,
  send_interval_min: DEFAULT_SCRAPER_INTERVAL_MIN,
  lead_sync_interval_min: DEFAULT_LEAD_SYNC_INTERVAL_MIN,
  send_email_interval_min: DEFAULT_SEND_EMAIL_INTERVAL_MIN,
  send_batch_limit: 1,
  auto_sync_status: 'running',
  auto_send_enabled: true,
  auto_send_status: 'running',
};

export const DEFAULT_EVERGREEN_RUNNER_CONFIG = {
  webhookUrl: '',
  baseUrl: '',
  maxPages: 3,
  budgetMaxRequests: 120,
  crawl4aiEndpoint: '',
  rateSeconds: 1,
  jobTitle: '',
  city: 'Poland',
  experienceLevel: '',
  testMode: false,
  apolloApiKey: '',
  apolloMaxPeoplePerCompany: 3,
  runId: '',
  crawl4aiHealthPath: '/health',
  sendIntervalMin: DEFAULT_SCRAPER_INTERVAL_MIN,
  leadSyncIntervalMin: DEFAULT_LEAD_SYNC_INTERVAL_MIN,
  sendEmailIntervalMin: DEFAULT_SEND_EMAIL_INTERVAL_MIN,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveSettingsObject(source = {}) {
  if (isPlainObject(source?.settings)) return source.settings;

  const parsedNestedSettings = parseJsonObject(source?.settings);
  if (parsedNestedSettings) return parsedNestedSettings;

  if (isPlainObject(source)) return source;

  const parsedSource = parseJsonObject(source);
  if (parsedSource) return parsedSource;

  return {};
}

function parseJsonObject(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pickDefined(...values) {
  for (const value of values) {
    if (typeof value !== 'undefined') return value;
  }
  return undefined;
}

function toTrimmedString(value, fallback = '') {
  if (value === null || typeof value === 'undefined') return fallback;
  return String(value).trim();
}

function toNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === null || typeof value === 'undefined') return fallback;
  return Boolean(value);
}

function toIntervalMin(value, fallback = null) {
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), 1440));
}

function getRunnerDefaults({ strict = false } = {}) {
  if (!strict) return DEFAULT_EVERGREEN_RUNNER_CONFIG;
  return DEFAULT_EVERGREEN_RUNNER_CONFIG;
}

function toPartialRunnerConfig(raw = {}) {
  return {
    webhookUrl: pickDefined(raw?.webhookUrl, raw?.webhook_url),
    baseUrl: pickDefined(raw?.baseUrl, raw?.base_url),
    maxPages: pickDefined(raw?.maxPages, raw?.max_pages),
    budgetMaxRequests: pickDefined(raw?.budgetMaxRequests, raw?.budget_max_requests),
    crawl4aiEndpoint: pickDefined(raw?.crawl4aiEndpoint, raw?.crawl4ai_endpoint),
    rateSeconds: pickDefined(raw?.rateSeconds, raw?.rate_seconds),
    jobTitle: pickDefined(raw?.jobTitle, raw?.job_title),
    city: pickDefined(raw?.city),
    experienceLevel: pickDefined(raw?.experienceLevel, raw?.experience_level),
    testMode: pickDefined(raw?.testMode, raw?.test_mode),
    apolloApiKey: pickDefined(raw?.apolloApiKey, raw?.apollo_api_key),
    apolloMaxPeoplePerCompany: pickDefined(raw?.apolloMaxPeoplePerCompany, raw?.apollo_max_people_per_company),
    runId: pickDefined(raw?.runId, raw?.run_id),
    crawl4aiHealthPath: pickDefined(raw?.crawl4aiHealthPath, raw?.crawl4ai_health_path),
    sendIntervalMin: pickDefined(raw?.sendIntervalMin, raw?.send_interval_min),
    leadSyncIntervalMin: pickDefined(raw?.leadSyncIntervalMin, raw?.lead_sync_interval_min),
    sendEmailIntervalMin: pickDefined(raw?.sendEmailIntervalMin, raw?.send_email_interval_min),
  };
}

export function normalizeEvergreenConfig(raw = {}, fallback = {}, { strict = false } = {}) {
  const defaults = getRunnerDefaults({ strict });
  const merged = {
    ...defaults,
    ...toPartialRunnerConfig(fallback),
    ...toPartialRunnerConfig(raw),
  };

  const sendIntervalCandidate = Number(merged.sendIntervalMin);
  const leadSyncIntervalCandidate = Number(merged.leadSyncIntervalMin);
  const sendEmailIntervalCandidate = Number(merged.sendEmailIntervalMin);

  return {
    webhookUrl: toTrimmedString(merged.webhookUrl, defaults.webhookUrl),
    baseUrl: toTrimmedString(merged.baseUrl, defaults.baseUrl),
    maxPages: Math.max(1, Math.trunc(toNumber(merged.maxPages, defaults.maxPages, { min: 1 }))),
    budgetMaxRequests: Math.max(1, Math.trunc(toNumber(merged.budgetMaxRequests, defaults.budgetMaxRequests, { min: 1 }))),
    crawl4aiEndpoint: toTrimmedString(merged.crawl4aiEndpoint, defaults.crawl4aiEndpoint),
    rateSeconds: toNumber(merged.rateSeconds, defaults.rateSeconds, { min: 0, max: 3600 }),
    jobTitle: merged.jobTitle === null || typeof merged.jobTitle === 'undefined' ? '' : String(merged.jobTitle),
    city: merged.city === null || typeof merged.city === 'undefined' ? '' : String(merged.city),
    experienceLevel: merged.experienceLevel === null || typeof merged.experienceLevel === 'undefined' ? '' : String(merged.experienceLevel),
    testMode: toBoolean(merged.testMode, defaults.testMode),
    apolloApiKey: merged.apolloApiKey === null || typeof merged.apolloApiKey === 'undefined' ? '' : String(merged.apolloApiKey),
    apolloMaxPeoplePerCompany: Math.max(1, Math.trunc(toNumber(merged.apolloMaxPeoplePerCompany, defaults.apolloMaxPeoplePerCompany, { min: 1 }))),
    runId: merged.runId === null || typeof merged.runId === 'undefined' ? '' : String(merged.runId),
    crawl4aiHealthPath: toTrimmedString(merged.crawl4aiHealthPath, defaults.crawl4aiHealthPath),
    sendIntervalMin: SEND_INTERVAL_OPTIONS.includes(sendIntervalCandidate) ? sendIntervalCandidate : defaults.sendIntervalMin,
    leadSyncIntervalMin: SEND_INTERVAL_OPTIONS.includes(leadSyncIntervalCandidate) ? leadSyncIntervalCandidate : defaults.leadSyncIntervalMin,
    sendEmailIntervalMin: SEND_INTERVAL_OPTIONS.includes(sendEmailIntervalCandidate) ? sendEmailIntervalCandidate : defaults.sendEmailIntervalMin,
  };
}

export function validateEvergreenRuntimeConfig(config = {}) {
  const normalized = normalizeEvergreenConfig(config, {}, { strict: true });

  if (!normalized.webhookUrl) throw new Error('Missing evergreen webhookUrl');
  if (!normalized.baseUrl) throw new Error('Missing evergreen baseUrl');
  if (!normalized.crawl4aiEndpoint) throw new Error('Missing evergreen crawl4aiEndpoint');

  return normalized;
}

export function toStoredEvergreenRunner(config = {}, options = {}) {
  const normalized = normalizeEvergreenConfig(config, {}, options);
  return {
    webhook_url: normalized.webhookUrl,
    base_url: normalized.baseUrl,
    max_pages: normalized.maxPages,
    budget_max_requests: normalized.budgetMaxRequests,
    crawl4ai_endpoint: normalized.crawl4aiEndpoint,
    rate_seconds: normalized.rateSeconds,
    job_title: normalized.jobTitle,
    city: normalized.city,
    experience_level: normalized.experienceLevel,
    test_mode: normalized.testMode,
    apollo_api_key: normalized.apolloApiKey,
    apollo_max_people_per_company: normalized.apolloMaxPeoplePerCompany,
    run_id: normalized.runId,
    crawl4ai_health_path: normalized.crawl4aiHealthPath,
  };
}

export function getCampaignRunnerConfig(source = {}, options = { strict: true }) {
  const settings = normalizeStoredCampaignSettings(resolveSettingsObject(source));
  const storedRunner = parseJsonObject(settings?.evergreen_runner) || settings?.evergreen_runner;
  return normalizeEvergreenConfig({
    ...(isPlainObject(storedRunner) ? storedRunner : {}),
    send_interval_min: settings?.send_interval_min,
    lead_sync_interval_min: settings?.lead_sync_interval_min,
    send_email_interval_min: settings?.send_email_interval_min,
  }, {}, options);
}

export function getStoredEvergreenRunner(source = {}) {
  const settings = resolveSettingsObject(source);
  return parseJsonObject(settings?.evergreen_runner);
}

export function normalizeStoredCampaignSettings(settings = {}) {
  const resolved = resolveSettingsObject(settings);
  if (!isPlainObject(resolved)) return {};
  const normalized = { ...resolved };
  const parsedRunner = parseJsonObject(resolved?.evergreen_runner);
  if (parsedRunner) normalized.evergreen_runner = parsedRunner;
  const scraperIntervalMin = toIntervalMin(resolved?.send_interval_min, DEFAULT_SCRAPER_INTERVAL_MIN);
  const leadSyncIntervalMin = toIntervalMin(
    typeof resolved?.lead_sync_interval_min !== 'undefined'
      ? resolved?.lead_sync_interval_min
      : (
        typeof resolved?.sync_interval_min !== 'undefined'
          ? resolved?.sync_interval_min
          : resolved?.send_interval_min
      ),
    DEFAULT_LEAD_SYNC_INTERVAL_MIN,
  );
  const sendEmailIntervalMin = toIntervalMin(resolved?.send_email_interval_min, DEFAULT_SEND_EMAIL_INTERVAL_MIN);

  if (scraperIntervalMin !== null) normalized.send_interval_min = scraperIntervalMin;
  if (leadSyncIntervalMin !== null) normalized.lead_sync_interval_min = leadSyncIntervalMin;
  if (sendEmailIntervalMin !== null) normalized.send_email_interval_min = sendEmailIntervalMin;
  if (!normalized.next_expected_sync_at && resolved?.next_expected_run_at) {
    normalized.next_expected_sync_at = resolved.next_expected_run_at;
  }
  delete normalized.sync_interval_min;
  delete normalized.next_expected_run_at;
  return normalized;
}

export function buildEditableCampaignSettings(settings = {}) {
  const cleanSettings = normalizeStoredCampaignSettings(settings);
  delete cleanSettings.evergreen_runner;
  return {
    ...DEFAULT_EVERGREEN_SETTINGS,
    ...cleanSettings,
    mode: 'evergreen',
  };
}

export function buildEvergreenWebhookPayload(config = {}, { campaignId, campaignName, mode = 'start' } = {}) {
  const normalized = normalizeEvergreenConfig(config, {}, { strict: true });
  return {
    baseUrl: normalized.baseUrl,
    maxPages: normalized.maxPages,
    budgetMaxRequests: normalized.budgetMaxRequests,
    crawl4aiEndpoint: normalized.crawl4aiEndpoint,
    rateSeconds: normalized.rateSeconds,
    jobTitle: normalized.jobTitle,
    city: normalized.city,
    experienceLevel: normalized.experienceLevel,
    testMode: mode === 'test' ? true : normalized.testMode,
    apolloApiKey: normalized.apolloApiKey,
    apolloMaxPeoplePerCompany: normalized.apolloMaxPeoplePerCompany,
    runId: normalized.runId || null,
    crawl4aiHealthPath: normalized.crawl4aiHealthPath,
    campaignId,
    campaignName,
    triggerMode: mode,
  };
}
