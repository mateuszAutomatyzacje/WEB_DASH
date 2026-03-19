import { getSql } from '@/lib/db.js';
import { shouldRunAutomaticCampaignTick, runCampaignCronTick } from '@/lib/campaign-cron.js';
import { normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

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
    where status = 'running'::public.campaign_status
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

    for (const campaign of dueCampaigns) {
      try {
        const result = await runCampaignCronTick(sql, {
          campaignId: campaign.id,
          campaignName: campaign.name,
          intervalMin: campaign.settings?.send_interval_min || campaign.settings?.sync_interval_min || 10,
          dryRun: false,
          source: 'internal_scheduler',
          executionMode: 'internal_scheduler',
        });

        if (!result.skipped_locked) {
          console.log(`[webdash:scheduler] tick ok campaign=${campaign.name} queued=${result.queued} sent=${result.sent} failed=${result.failed}`);
        }
      } catch (error) {
        console.error(`[webdash:scheduler] tick failed campaign=${campaign.name}:`, error);
      }
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
  void runSweep();
  return true;
}
