import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { getCampaignRuntimeState, getNextExpectedRunAt, resolveOrCreateCampaign, runCampaignGuard } from '@/lib/campaign-guard.js';

const LOCK_NAMESPACE = 'webdash_campaign_cron_v1';

function toPositiveInt(value, fallback, { min = 1, max = 1440 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function resolveSendLimit(value, settings = {}, fallback = 1) {
  const fromSettings = settings?.send_batch_limit ?? settings?.sendBatchLimit ?? settings?.send_limit ?? settings?.sendLimit;
  const raw = typeof value === 'undefined' || value === null ? fromSettings : value;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), 200));
}

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

async function withCampaignLock(sql, campaignId, fn) {
  const reserved = typeof sql.reserve === 'function' ? await sql.reserve() : sql;
  const shouldRelease = reserved !== sql && typeof reserved.release === 'function';

  try {
    const lockRows = await reserved`
      select pg_try_advisory_lock(hashtext(${LOCK_NAMESPACE}), hashtext(${String(campaignId)})) as locked
    `;
    const locked = Boolean(lockRows[0]?.locked);

    if (!locked) {
      return { locked: false, result: null };
    }

    try {
      return { locked: true, result: await fn(reserved) };
    } finally {
      await reserved`
        select pg_advisory_unlock(hashtext(${LOCK_NAMESPACE}), hashtext(${String(campaignId)}))
      `;
    }
  } finally {
    if (shouldRelease) await reserved.release();
  }
}

export function shouldRunAutomaticCampaignTick(campaign, nowMs = Date.now()) {
  if (!campaign || campaign.status !== 'running') return false;

  const settings = normalizeStoredCampaignSettings(campaign.settings);
  const runtime = getCampaignRuntimeState(settings);

  if (!runtime.auto_sync_enabled && !runtime.auto_send_enabled) return false;

  const nextExpectedMs = parseDateMs(settings.next_expected_run_at);
  if (nextExpectedMs !== null) return nextExpectedMs <= nowMs;

  const lastTickMs = [
    settings.last_sync_at,
    settings.last_auto_send_at,
    settings.last_scheduler_send_at,
  ]
    .map(parseDateMs)
    .filter((value) => value !== null)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(lastTickMs)) return true;

  const intervalMs = toPositiveInt(runtime.send_interval_min, 10, { min: 1, max: 1440 }) * 60 * 1000;
  return lastTickMs + intervalMs <= nowMs;
}

export async function runCampaignCronTick(sql, {
  campaignId = null,
  campaignName = DEFAULT_EVERGREEN_NAME,
  intervalMin = null,
  limit = null,
  dryRun = false,
  forceSync = false,
  forceSend = false,
  source = 'webdash_cron_sync',
  executionMode = null,
} = {}) {
  const campaign = await resolveOrCreateCampaign(sql, {
    campaignId,
    campaignName,
    source,
  });

  const lockResult = await withCampaignLock(sql, campaign.id, async (lockedSql) => {
    const freshCampaign = await resolveOrCreateCampaign(lockedSql, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      source,
    });

    const settings = normalizeStoredCampaignSettings(freshCampaign.settings);
    const runtime = getCampaignRuntimeState(settings);
    const autoSyncEnabled = forceSync === true ? true : runtime.auto_sync_enabled;
    const autoSendEnabled = forceSend === true ? true : runtime.auto_send_enabled;
    const resolvedIntervalMin = toPositiveInt(
      intervalMin,
      Number(runtime.send_interval_min || settings.send_interval_min || 10),
      { min: 1, max: 1440 },
    );
    const resolvedLimit = resolveSendLimit(limit, settings);

    let sendResult = null;
    if (autoSendEnabled || dryRun) {
      sendResult = await runCampaignGuard(lockedSql, {
        campaignId: freshCampaign.id,
        campaignName: freshCampaign.name,
        dryRun,
        limit: resolvedLimit,
        performSync: autoSyncEnabled,
        source,
        executionMode: executionMode || (dryRun ? 'cron_sync_preview' : 'cron_sync'),
      });
    } else {
      sendResult = await runCampaignGuard(lockedSql, {
        campaignId: freshCampaign.id,
        campaignName: freshCampaign.name,
        dryRun: true,
        limit: resolvedLimit,
        performSync: autoSyncEnabled,
        source,
        executionMode: executionMode || 'cron_sync_preview',
      });
    }

    const nowIso = new Date().toISOString();
    const nextExpectedRunAt = getNextExpectedRunAt(settings, resolvedIntervalMin);
    const schedulerResult = {
      dry_run: dryRun,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      replied_stopped: sendResult?.replied?.stopped ?? 0,
      skipped_live_send: !autoSendEnabled && !dryRun,
      timestamp: nowIso,
      source,
    };
    const mergedSettings = {
      ...settings,
      auto_sync_enabled: autoSyncEnabled,
      auto_sync_status: autoSyncEnabled ? 'running' : 'paused',
      auto_send_enabled: autoSendEnabled,
      auto_send_status: autoSendEnabled ? 'running' : 'paused',
      send_interval_min: resolvedIntervalMin,
      last_sync_at: nowIso,
      last_sync_ok: true,
      next_expected_run_at: nextExpectedRunAt,
      last_auto_send_at: !dryRun && autoSendEnabled ? nowIso : runtime.last_auto_send_at,
      last_scheduler_send_at: !dryRun && autoSendEnabled ? nowIso : (settings.last_scheduler_send_at || null),
      last_sync_result: sendResult?.sync || {},
      last_send_result: schedulerResult,
      last_scheduler_result: schedulerResult,
    };
    delete mergedSettings.sync_interval_min;

    await lockedSql`
      update public.campaigns
      set
        settings = ${lockedSql.json(mergedSettings)}::jsonb,
        updated_at = now()
      where id = ${freshCampaign.id}::uuid
    `;

    return {
      ok: true,
      mode: dryRun ? 'cron-preview' : (autoSendEnabled ? 'cron-sync-send' : 'cron-sync-only'),
      campaign_id: freshCampaign.id,
      campaign_name: freshCampaign.name,
      campaign: freshCampaign,
      auto_sync_enabled: autoSyncEnabled,
      auto_send_enabled: autoSendEnabled,
      next_expected_run_at: nextExpectedRunAt,
      sync: sendResult?.sync || null,
      replied: sendResult?.replied || null,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      skipped_live_send: !autoSendEnabled && !dryRun,
      outbox_preview: sendResult?.outbox_preview || [],
      results: sendResult?.results || [],
    };
  });

  if (!lockResult.locked) {
    return {
      ok: true,
      mode: 'cron-sync-skipped',
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      campaign,
      auto_sync_enabled: false,
      auto_send_enabled: false,
      queued: 0,
      sent: 0,
      failed: 0,
      skipped_live_send: true,
      skipped_locked: true,
      outbox_preview: [],
      results: [],
      sync: null,
      replied: null,
      next_expected_run_at: null,
    };
  }

  return {
    ...lockResult.result,
    skipped_locked: false,
  };
}
