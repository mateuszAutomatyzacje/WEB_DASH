import { getSql } from '@/lib/db.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';
import { shouldRunAutomaticCampaignTick, runCampaignCronTick } from '@/lib/campaign-cron.js';
import { normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { getLeadExportDigestTickState, runLeadExportDigest } from '@/lib/export-digest.js';
import { getScrapeTickState, runScrapeTick } from '@/lib/scrape-cron.js';

const GLOBAL_KEY = '__WEBDASH_INTERNAL_SCHEDULER__';
const DEFAULT_POLL_MS = 60 * 1000;
const MAX_CAMPAIGNS_PER_SWEEP = 25;

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      started: false,
      running: false,
      timer: null,
      lastSweepAt: null,
      lastError: null,
    };
  }
  return globalThis[GLOBAL_KEY];
}

function schedulerEnabled() {
  if (process.env.WEBDASH_INTERNAL_SCHEDULER_DISABLED === '1') return false;
  if (process.env.NODE_ENV === 'production') return true;
  return process.env.WEBDASH_INTERNAL_SCHEDULER_DEV === '1';
}

function getPollMs() {
  const numeric = Number(process.env.WEBDASH_INTERNAL_SCHEDULER_POLL_MS || DEFAULT_POLL_MS);
  return Number.isFinite(numeric) && numeric >= 5_000 ? numeric : DEFAULT_POLL_MS;
}

async function loadSchedulerCandidates(sql) {
  const rows = await sql`
    select id, name, status::text as status, settings, created_at, updated_at
    from public.campaigns
    where status in ('running'::public.campaign_status, 'paused'::public.campaign_status, 'stopped'::public.campaign_status)
      and coalesce(settings->>'mode', '') = 'evergreen'
    order by updated_at desc
    limit ${MAX_CAMPAIGNS_PER_SWEEP}
  `;

  return rows.map((row) => ({
    ...row,
    settings: normalizeStoredCampaignSettings(row.settings),
  }));
}

async function runSweep() {
  const state = getState();
  if (state.running) return;

  state.running = true;
  try {
    const sql = getSql();
    const campaigns = await loadSchedulerCandidates(sql);
    const dueCampaigns = campaigns.filter((campaign) => shouldRunAutomaticCampaignTick(campaign));

    if (dueCampaigns.length > 0) {
      await logApplicationEventSafe(sql, {
        level: 'info',
        scope: 'scheduler',
        source: 'internal_scheduler',
        eventType: 'scheduler_sweep_started',
        message: `Scheduler sweep started. Loaded evergreen campaigns: ${campaigns.length}, due now: ${dueCampaigns.length}.`,
        details: {
          loaded_campaigns: campaigns.length,
          due_campaigns: dueCampaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
          })),
        },
      });
    }

    for (const campaign of dueCampaigns) {
      try {
        const result = await runCampaignCronTick(sql, {
          campaignId: campaign.id,
          campaignName: campaign.name,
          dryRun: false,
          source: 'internal_scheduler',
          executionMode: 'internal_scheduler',
        });

        if (!result.skipped_locked) {
          console.log(`[webdash:scheduler] tick ok campaign=${campaign.name} queued=${result.queued} sent=${result.sent} failed=${result.failed}`);
          await logApplicationEventSafe(sql, {
            level: result.failed > 0 ? 'warn' : 'success',
            scope: 'scheduler',
            source: 'internal_scheduler',
            eventType: 'scheduler_campaign_tick_completed',
            message: `Scheduler finished campaign tick for ${campaign.name}. queued=${result.queued}, sent=${result.sent}, failed=${result.failed}.`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            details: {
              queued: result.queued,
              sent: result.sent,
              failed: result.failed,
              skipped_live_send: Boolean(result.skipped_live_send),
              next_expected_sync_at: result.next_expected_sync_at || null,
              next_expected_send_at: result.next_expected_send_at || null,
            },
          });
        }
      } catch (error) {
        console.error(`[webdash:scheduler] tick failed campaign=${campaign.name}:`, error);
        await logApplicationEventSafe(sql, {
          level: 'error',
          scope: 'scheduler',
          source: 'internal_scheduler',
          eventType: 'scheduler_campaign_tick_failed',
          message: `Scheduler failed campaign tick for ${campaign.name}: ${String(error?.message || error)}`,
          campaignId: campaign.id,
          campaignName: campaign.name,
          details: {
            error: String(error?.message || error),
          },
        });
      }
    }

    try {
      const scrapeTick = await getScrapeTickState(sql);
      if (!scrapeTick.skipped) {
        const scrapeResult = await runScrapeTick(sql, { source: 'internal_scheduler' });
        if (!scrapeResult.skipped) {
          console.log(`[webdash:scheduler] scrape tick ok campaign=${scrapeResult.campaign || '-'} status=${scrapeResult.run?.status || 'unknown'}`);
          await logApplicationEventSafe(sql, {
            level: scrapeResult.run?.status === 'queued' ? 'success' : 'info',
            scope: 'scheduler',
            source: 'internal_scheduler',
            eventType: 'scheduler_scrape_tick_completed',
            message: `Scheduler triggered scraper for ${scrapeResult.campaign || '-'}. status=${scrapeResult.run?.status || 'unknown'}.`,
            campaignName: scrapeResult.campaign || null,
            details: {
              interval_min: scrapeResult.interval_min,
              next_run_at: scrapeResult.next_run_at,
              run_status: scrapeResult.run?.status || null,
            },
          });
        }
      }
    } catch (error) {
      console.error('[webdash:scheduler] scrape tick failed:', error);
      await logApplicationEventSafe(sql, {
        level: 'error',
        scope: 'scheduler',
        source: 'internal_scheduler',
        eventType: 'scheduler_scrape_tick_failed',
        message: `Scheduler scrape tick failed: ${String(error?.message || error)}`,
        details: {
          error: String(error?.message || error),
        },
      });
    }

    try {
      const exportTick = await getLeadExportDigestTickState(sql);
      if (!exportTick.skipped) {
        const exportResult = await runLeadExportDigest(sql, { manual: false, source: 'internal_scheduler' });
        if (!exportResult.skipped) {
          console.log(`[webdash:scheduler] export digest ok recipient=${exportResult.recipient_email} rows=${exportResult.row_count}`);
          await logApplicationEventSafe(sql, {
            level: 'success',
            scope: 'scheduler',
            source: 'internal_scheduler',
            eventType: 'scheduler_export_digest_completed',
            message: `Scheduler sent daily export digest to ${exportResult.recipient_email}. rows=${exportResult.row_count}.`,
            details: {
              recipient_email: exportResult.recipient_email,
              row_count: exportResult.row_count,
              attachment_filename: exportResult.attachment_filename || null,
            },
          });
        }
      }
    } catch (error) {
      console.error('[webdash:scheduler] export digest failed:', error);
      await logApplicationEventSafe(sql, {
        level: 'error',
        scope: 'scheduler',
        source: 'internal_scheduler',
        eventType: 'scheduler_export_digest_failed',
        message: `Scheduler export digest failed: ${String(error?.message || error)}`,
        details: {
          error: String(error?.message || error),
        },
      });
    }

    state.lastSweepAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.lastError = String(error?.message || error);
    console.error('[webdash:scheduler] sweep failed:', error);
  } finally {
    state.running = false;
  }
}

export function ensureInternalSchedulerStarted(source = 'unknown') {
  const state = getState();
  if (!schedulerEnabled()) return false;
  if (state.started) return true;

  state.started = true;
  const pollMs = getPollMs();

  state.timer = setInterval(() => {
    void runSweep();
  }, pollMs);

  if (typeof state.timer?.unref === 'function') {
    state.timer.unref();
  }

  console.log(`[webdash:scheduler] started source=${source} poll_ms=${pollMs}`);
  try {
    const sql = getSql();
    void logApplicationEventSafe(sql, {
      level: 'info',
      scope: 'scheduler',
      source,
      eventType: 'scheduler_started',
      message: `Internal scheduler started. Poll interval ${pollMs / 1000}s.`,
      details: {
        poll_ms: pollMs,
      },
    });
  } catch {}
  void runSweep();
  return true;
}
