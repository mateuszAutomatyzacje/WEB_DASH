export const DEFAULT_EVERGREEN_NAME = 'OUTSOURCING_IT_EVERGREEM';
export const DEFAULT_EVERGREEN_WEBHOOK_URL = 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger';
export const SEND_INTERVAL_OPTIONS = [5, 10, 15];

export const DEFAULT_EVERGREEN_SETTINGS = {
  mode: 'evergreen',
  auto_enqueue: true,
  auto_sync_enabled: true,
  sync_interval_min: 10,
  auto_sync_status: 'running',
  auto_send_enabled: true,
  auto_send_status: 'running',
};

export const DEFAULT_EVERGREEN_RUNNER_CONFIG = {
  webhookUrl: DEFAULT_EVERGREEN_WEBHOOK_URL,
  baseUrl: 'https://justjoin.it/job-offers',
  maxPages: 3,
  budgetMaxRequests: 120,
  crawl4aiEndpoint: 'https://crawl4ai-production-0915.up.railway.app/crawl',
  rateSeconds: 1,
  jobTitle: '',
  city: 'Poland',
  experienceLevel: '',
  testMode: false,
  apolloApiKey: '',
  apolloMaxPeoplePerCompany: 3,
  runId: '',
  crawl4aiHealthPath: '/health',
  sendIntervalMin: 5,
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
  };
}

export function normalizeEvergreenConfig(raw = {}, fallback = {}) {
  const merged = {
    ...DEFAULT_EVERGREEN_RUNNER_CONFIG,
    ...toPartialRunnerConfig(fallback),
    ...toPartialRunnerConfig(raw),
  };

  const sendIntervalCandidate = Number(merged.sendIntervalMin);

  return {
    webhookUrl: toTrimmedString(merged.webhookUrl, DEFAULT_EVERGREEN_RUNNER_CONFIG.webhookUrl),
    baseUrl: toTrimmedString(merged.baseUrl, DEFAULT_EVERGREEN_RUNNER_CONFIG.baseUrl),
    maxPages: Math.max(1, Math.trunc(toNumber(merged.maxPages, DEFAULT_EVERGREEN_RUNNER_CONFIG.maxPages, { min: 1 }))),
    budgetMaxRequests: Math.max(1, Math.trunc(toNumber(merged.budgetMaxRequests, DEFAULT_EVERGREEN_RUNNER_CONFIG.budgetMaxRequests, { min: 1 }))),
    crawl4aiEndpoint: toTrimmedString(merged.crawl4aiEndpoint, DEFAULT_EVERGREEN_RUNNER_CONFIG.crawl4aiEndpoint),
    rateSeconds: toNumber(merged.rateSeconds, DEFAULT_EVERGREEN_RUNNER_CONFIG.rateSeconds, { min: 0, max: 3600 }),
    jobTitle: merged.jobTitle === null || typeof merged.jobTitle === 'undefined' ? '' : String(merged.jobTitle),
    city: merged.city === null || typeof merged.city === 'undefined' ? '' : String(merged.city),
    experienceLevel: merged.experienceLevel === null || typeof merged.experienceLevel === 'undefined' ? '' : String(merged.experienceLevel),
    testMode: toBoolean(merged.testMode, DEFAULT_EVERGREEN_RUNNER_CONFIG.testMode),
    apolloApiKey: merged.apolloApiKey === null || typeof merged.apolloApiKey === 'undefined' ? '' : String(merged.apolloApiKey),
    apolloMaxPeoplePerCompany: Math.max(1, Math.trunc(toNumber(merged.apolloMaxPeoplePerCompany, DEFAULT_EVERGREEN_RUNNER_CONFIG.apolloMaxPeoplePerCompany, { min: 1 }))),
    runId: merged.runId === null || typeof merged.runId === 'undefined' ? '' : String(merged.runId),
    crawl4aiHealthPath: toTrimmedString(merged.crawl4aiHealthPath, DEFAULT_EVERGREEN_RUNNER_CONFIG.crawl4aiHealthPath),
    sendIntervalMin: SEND_INTERVAL_OPTIONS.includes(sendIntervalCandidate) ? sendIntervalCandidate : DEFAULT_EVERGREEN_RUNNER_CONFIG.sendIntervalMin,
  };
}

export function toStoredEvergreenRunner(config = {}) {
  const normalized = normalizeEvergreenConfig(config);
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

export function getCampaignRunnerConfig(source = {}) {
  const settings = resolveSettingsObject(source);
  const storedRunner = parseJsonObject(settings?.evergreen_runner) || settings?.evergreen_runner;
  return normalizeEvergreenConfig({
    ...(isPlainObject(storedRunner) ? storedRunner : {}),
    send_interval_min: settings?.send_interval_min,
  });
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
  return normalized;
}

export function buildEditableCampaignSettings(settings = {}) {
  const cleanSettings = normalizeStoredCampaignSettings(settings);
  delete cleanSettings.evergreen_runner;
  delete cleanSettings.send_interval_min;
  return {
    ...DEFAULT_EVERGREEN_SETTINGS,
    ...cleanSettings,
    mode: 'evergreen',
  };
}

export function buildEvergreenWebhookPayload(config = {}, { campaignId, campaignName, mode = 'start' } = {}) {
  const normalized = normalizeEvergreenConfig(config);
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
