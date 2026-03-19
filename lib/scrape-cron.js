import { ensureScrapeSettings, getScrapeIntervalMin, getScrapeWebhookUrl, syncScrapeSettingsFromCampaign } from '@/lib/scrape-settings.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

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

export async function getScrapeTickState(sql, { campaignId = null, campaignName = null, nowMs = Date.now() } = {}) {
  const synced = await syncScrapeSettingsFromCampaign(sql, { campaignId, campaignName }).catch(() => null);
  const ensured = await ensureScrapeSettings(sql, { campaignName });
  const cfg = synced?.settings || ensured?.settings;

  if (!cfg) throw new Error("Missing scrape_settings row id='global'");
  if (!cfg.running) {
    return {
      ok: true,
      skipped: true,
      reason: 'running=false',
      settings: cfg,
      interval_min: null,
      interval_source: null,
      campaign: synced?.source_campaign || campaignName || null,
      next_run_at: null,
    };
  }

  const schedule = await getScrapeIntervalMin(sql, { campaignName });
  if (!schedule.intervalMin) throw new Error('Missing send_interval_min for scraper schedule');

  const lastRunMs = parseDateMs(cfg.last_run_at);
  const nextRunMs = lastRunMs === null ? null : lastRunMs + schedule.intervalMin * 60 * 1000;
  const due = nextRunMs === null || nowMs >= nextRunMs;

  return {
    ok: true,
    skipped: !due,
    reason: due ? null : 'interval',
    settings: cfg,
    interval_min: schedule.intervalMin,
    interval_source: schedule.source,
    campaign: schedule.campaign,
    next_run_at: nextRunMs === null ? null : new Date(nextRunMs).toISOString(),
  };
}

export async function runScrapeNow(sql, { campaignId = null, campaignName = null, source = 'scrape_run' } = {}) {
  const synced = await syncScrapeSettingsFromCampaign(sql, { campaignId, campaignName }).catch(() => null);
  const { settings: cfg } = await ensureScrapeSettings(sql, { campaignName });
  if (!cfg) throw new Error("Missing scrape_settings row id='global'");
  if (!cfg.running) {
    await logApplicationEventSafe(sql, {
      level: 'warn',
      scope: 'scraper',
      source,
      eventType: 'scrape_run_skipped_disabled',
      message: `Scraper run skipped for ${synced?.source_campaign || campaignName || '-'}. running=false.`,
      campaignName: synced?.source_campaign || campaignName || null,
    });
    return { ok: true, skipped: true, reason: 'running=false', source };
  }

  const resolvedWebhook = await getScrapeWebhookUrl(sql, { campaignName });
  const runnerWebhookUrl = resolvedWebhook.webhookUrl;
  if (!runnerWebhookUrl) {
    await logApplicationEventSafe(sql, {
      level: 'error',
      scope: 'scraper',
      source,
      eventType: 'scrape_config_missing',
      message: `Scraper run cannot start for ${synced?.source_campaign || resolvedWebhook.campaign || campaignName || '-'}. Missing evergreen_runner.webhook_url.`,
      campaignName: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
    });
    throw new Error('Missing evergreen_runner.webhook_url');
  }

  const token = process.env.JUSTJOIN_SCRAPER_WEBHOOK_TOKEN || null;
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
    await logApplicationEventSafe(sql, {
      level: 'warn',
      scope: 'scraper',
      source,
      eventType: 'scrape_run_skipped_locked',
      message: `Scraper run skipped for ${synced?.source_campaign || resolvedWebhook.campaign || campaignName || '-'}. Lock is still active.`,
      campaignName: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
    });
    return { ok: true, skipped: true, reason: 'locked', source };
  }

  await sql`
    update public.scrape_settings
    set last_run_status = 'running',
        last_run_at = now(),
        updated_at = now()
    where id = 'global'
  `;

  await logApplicationEventSafe(sql, {
    level: 'info',
    scope: 'scraper',
    source,
    eventType: 'scrape_run_started',
    message: `Scraper run started for ${synced?.source_campaign || resolvedWebhook.campaign || campaignName || '-'}.`,
    campaignName: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
    details: {
      webhook_url: runnerWebhookUrl,
      base_url: cfg.base_url,
      max_pages: cfg.max_pages,
    },
  });

  const payload = buildRunnerPayload(cfg);
  const res = await fetch(runnerWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok || json?.ok === false) {
    const errMsg = json?.error || json?.message || `HTTP ${res.status}`;
    await sql`
      update public.scrape_settings
      set last_run_status = 'error',
          updated_at = now(),
          locked_until = null
      where id = 'global'
    `;
    await logApplicationEventSafe(sql, {
      level: 'error',
      scope: 'scraper',
      source,
      eventType: 'scrape_run_failed',
      message: `Scraper webhook failed for ${synced?.source_campaign || resolvedWebhook.campaign || campaignName || '-'}.`,
      campaignName: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
      details: {
        error: errMsg,
        webhook_url: runnerWebhookUrl,
      },
    });
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

  await logApplicationEventSafe(sql, {
    level: 'success',
    scope: 'scraper',
    source,
    eventType: 'scrape_run_queued',
    message: `Scraper webhook queued for ${synced?.source_campaign || resolvedWebhook.campaign || campaignName || '-'}.`,
    campaignName: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
    details: {
      run_id: runId,
      webhook_url: runnerWebhookUrl,
    },
  });

  return {
    ok: true,
    runId,
    status: 'queued',
    last_run_at: new Date().toISOString(),
    source,
    webhook_url: runnerWebhookUrl,
    webhook_response: json,
    campaign: synced?.source_campaign || resolvedWebhook.campaign || campaignName || null,
  };
}

export async function runScrapeTick(sql, { campaignId = null, campaignName = null, source = 'scrape_tick' } = {}) {
  const tick = await getScrapeTickState(sql, { campaignId, campaignName });
  if (tick.skipped) {
    if (tick.reason !== 'interval' || source !== 'internal_scheduler') {
      await logApplicationEventSafe(sql, {
        level: tick.reason === 'running=false' ? 'warn' : 'info',
        scope: 'scraper',
        source,
        eventType: 'scrape_tick_skipped',
        message: `Scraper tick skipped for ${tick.campaign || campaignName || '-'}. reason=${tick.reason || 'unknown'}.`,
        campaignName: tick.campaign || campaignName || null,
        details: {
          reason: tick.reason || null,
          interval_min: tick.interval_min,
          next_run_at: tick.next_run_at,
        },
      });
    }
    return {
      ok: true,
      tick: true,
      skipped: true,
      reason: tick.reason,
      interval_min: tick.interval_min,
      interval_source: tick.interval_source,
      campaign: tick.campaign,
      next_run_at: tick.next_run_at,
      source,
    };
  }

  const run = await runScrapeNow(sql, { campaignId, campaignName, source });
  return {
    ok: true,
    tick: true,
    skipped: false,
    interval_min: tick.interval_min,
    interval_source: tick.interval_source,
    campaign: tick.campaign,
    next_run_at: tick.next_run_at,
    run,
    source,
  };
}
