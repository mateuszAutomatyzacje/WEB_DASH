import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';
import { getCampaignRuntimeState, getNextExpectedAt, resolveOrCreateCampaign, runCampaignGuard } from '@/lib/campaign-guard.js';

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

function isTaskDue({ enabled, nextExpectedAt = null, lastAt = null, intervalMin = 10, nowMs = Date.now() }) {
  if (!enabled) return false;

  const nextExpectedMs = parseDateMs(nextExpectedAt);
  if (nextExpectedMs !== null) return nextExpectedMs <= nowMs;

  const lastMs = parseDateMs(lastAt);
  if (lastMs === null) return true;

  return lastMs + toPositiveInt(intervalMin, 10, { min: 1, max: 1440 }) * 60 * 1000 <= nowMs;
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

  const syncDue = isTaskDue({
    enabled: runtime.auto_sync_enabled,
    nextExpectedAt: runtime.next_expected_sync_at,
    lastAt: runtime.last_sync_at,
    intervalMin: runtime.lead_sync_interval_min,
    nowMs,
  });
  const sendDue = isTaskDue({
    enabled: runtime.auto_send_enabled,
    nextExpectedAt: runtime.next_expected_send_at,
    lastAt: runtime.last_auto_send_at,
    intervalMin: runtime.send_email_interval_min,
    nowMs,
  });

  return syncDue || sendDue;
}

export async function runCampaignCronTick(sql, {
  campaignId = null,
  campaignName = DEFAULT_EVERGREEN_NAME,
  intervalMin = null,
  leadSyncIntervalMin = null,
  sendEmailIntervalMin = null,
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
    const resolvedLeadSyncIntervalMin = toPositiveInt(
      leadSyncIntervalMin ?? intervalMin,
      Number(runtime.lead_sync_interval_min || settings.lead_sync_interval_min || settings.send_interval_min || 30),
      { min: 1, max: 1440 },
    );
    const resolvedSendEmailIntervalMin = toPositiveInt(
      sendEmailIntervalMin,
      Number(runtime.send_email_interval_min || settings.send_email_interval_min || 5),
      { min: 1, max: 1440 },
    );
    const resolvedLimit = resolveSendLimit(limit, settings);
    const nowMs = Date.now();
    const shouldSync = forceSync === true || isTaskDue({
      enabled: autoSyncEnabled,
      nextExpectedAt: runtime.next_expected_sync_at,
      lastAt: runtime.last_sync_at,
      intervalMin: resolvedLeadSyncIntervalMin,
      nowMs,
    });
    const shouldSend = forceSend === true || isTaskDue({
      enabled: autoSendEnabled,
      nextExpectedAt: runtime.next_expected_send_at,
      lastAt: runtime.last_auto_send_at,
      intervalMin: resolvedSendEmailIntervalMin,
      nowMs,
    });

    const nextExpectedSyncAt = shouldSync
      ? getNextExpectedAt(resolvedLeadSyncIntervalMin)
      : (runtime.next_expected_sync_at || null);
    const nextExpectedSendAt = shouldSend
      ? getNextExpectedAt(resolvedSendEmailIntervalMin)
      : (runtime.next_expected_send_at || null);

    await logApplicationEventSafe(lockedSql, {
      level: 'info',
      scope: 'campaign',
      source,
      eventType: 'campaign_tick_started',
      message: `Campaign tick started for ${freshCampaign.name}. sync=${shouldSync ? 'due' : 'skip'}, send=${shouldSend ? 'due' : 'skip'}, limit=${resolvedLimit}.`,
      campaignId: freshCampaign.id,
      campaignName: freshCampaign.name,
      details: {
        dry_run: Boolean(dryRun),
        force_sync: Boolean(forceSync),
        force_send: Boolean(forceSend),
        lead_sync_interval_min: resolvedLeadSyncIntervalMin,
        send_email_interval_min: resolvedSendEmailIntervalMin,
        limit: resolvedLimit,
      },
    });

    if (!shouldSync && !shouldSend && !dryRun) {
      await logApplicationEventSafe(lockedSql, {
        level: 'info',
        scope: 'campaign',
        source,
        eventType: 'campaign_tick_idle',
        message: `Campaign tick skipped for ${freshCampaign.name}. Nothing is due right now.`,
        campaignId: freshCampaign.id,
        campaignName: freshCampaign.name,
        details: {
          next_expected_sync_at: nextExpectedSyncAt,
          next_expected_send_at: nextExpectedSendAt,
        },
      });
      return {
        ok: true,
        mode: 'cron-sync-idle',
        campaign_id: freshCampaign.id,
        campaign_name: freshCampaign.name,
        campaign: freshCampaign,
        auto_sync_enabled: autoSyncEnabled,
        auto_send_enabled: autoSendEnabled,
        next_expected_sync_at: nextExpectedSyncAt,
        next_expected_send_at: nextExpectedSendAt,
        queued: 0,
        sent: 0,
        failed: 0,
        skipped_live_send: true,
        skipped_not_due: true,
        outbox_preview: [],
        results: [],
        sync: null,
        replied: null,
      };
    }

    let sendResult = null;
    sendResult = await runCampaignGuard(lockedSql, {
      campaignId: freshCampaign.id,
      campaignName: freshCampaign.name,
      dryRun: dryRun || !shouldSend,
      limit: resolvedLimit,
      performSync: shouldSync,
      source,
      executionMode: executionMode || (dryRun || !shouldSend ? 'cron_sync_preview' : 'cron_sync'),
    });

    const nowIso = new Date().toISOString();
    const schedulerResult = {
      dry_run: dryRun || !shouldSend,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      replied_stopped: sendResult?.replied?.stopped ?? 0,
      skipped_live_send: !shouldSend && !dryRun,
      sync_performed: shouldSync,
      send_performed: shouldSend && !dryRun,
      timestamp: nowIso,
      source,
    };
    const mergedSettings = {
      ...settings,
      auto_sync_enabled: autoSyncEnabled,
      auto_sync_status: autoSyncEnabled ? 'running' : 'paused',
      auto_send_enabled: autoSendEnabled,
      auto_send_status: autoSendEnabled ? 'running' : 'paused',
      lead_sync_interval_min: resolvedLeadSyncIntervalMin,
      send_email_interval_min: resolvedSendEmailIntervalMin,
      last_sync_at: shouldSync ? nowIso : runtime.last_sync_at,
      last_sync_ok: shouldSync ? true : settings.last_sync_ok,
      next_expected_sync_at: nextExpectedSyncAt,
      last_auto_send_at: shouldSend && !dryRun ? nowIso : runtime.last_auto_send_at,
      next_expected_send_at: nextExpectedSendAt,
      last_scheduler_send_at: shouldSend && !dryRun ? nowIso : (settings.last_scheduler_send_at || null),
      last_sync_result: shouldSync ? (sendResult?.sync || {}) : (settings.last_sync_result || null),
      last_send_result: shouldSend || dryRun ? schedulerResult : (settings.last_send_result || null),
      last_scheduler_result: shouldSend || dryRun ? schedulerResult : (settings.last_scheduler_result || settings.last_send_result || null),
    };
    delete mergedSettings.sync_interval_min;
    delete mergedSettings.next_expected_run_at;

    await lockedSql`
      update public.campaigns
      set
        settings = ${lockedSql.json(mergedSettings)}::jsonb,
        updated_at = now()
      where id = ${freshCampaign.id}::uuid
    `;

    await logApplicationEventSafe(lockedSql, {
      level: sendResult?.failed > 0 ? 'warn' : 'success',
      scope: 'campaign',
      source,
      eventType: 'campaign_tick_completed',
      message: `Campaign tick finished for ${freshCampaign.name}. queued=${sendResult?.queued ?? 0}, sent=${sendResult?.sent ?? 0}, failed=${sendResult?.failed ?? 0}.`,
      campaignId: freshCampaign.id,
      campaignName: freshCampaign.name,
      details: {
        mode: dryRun ? 'cron-preview' : (shouldSend ? 'cron-sync-send' : 'cron-sync-only'),
        queued: sendResult?.queued ?? 0,
        sent: sendResult?.sent ?? 0,
        failed: sendResult?.failed ?? 0,
        sync_performed: shouldSync,
        send_performed: shouldSend && !dryRun,
        next_expected_sync_at: nextExpectedSyncAt,
        next_expected_send_at: nextExpectedSendAt,
      },
    });

    return {
      ok: true,
      mode: dryRun ? 'cron-preview' : (shouldSend ? 'cron-sync-send' : 'cron-sync-only'),
      campaign_id: freshCampaign.id,
      campaign_name: freshCampaign.name,
      campaign: freshCampaign,
      auto_sync_enabled: autoSyncEnabled,
      auto_send_enabled: autoSendEnabled,
      next_expected_sync_at: nextExpectedSyncAt,
      next_expected_send_at: nextExpectedSendAt,
      sync: sendResult?.sync || null,
      replied: sendResult?.replied || null,
      queued: sendResult?.queued ?? 0,
      sent: sendResult?.sent ?? 0,
      failed: sendResult?.failed ?? 0,
      skipped_live_send: !shouldSend && !dryRun,
      outbox_preview: sendResult?.outbox_preview || [],
      results: sendResult?.results || [],
    };
  });

  if (!lockResult.locked) {
    await logApplicationEventSafe(sql, {
      level: 'warn',
      scope: 'campaign',
      source,
      eventType: 'campaign_tick_skipped_locked',
      message: `Campaign tick skipped for ${campaign.name}. Another worker holds the advisory lock.`,
      campaignId: campaign.id,
      campaignName: campaign.name,
    });
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
      next_expected_sync_at: null,
      next_expected_send_at: null,
    };
  }

  return {
    ...lockResult.result,
    skipped_locked: false,
  };
}
