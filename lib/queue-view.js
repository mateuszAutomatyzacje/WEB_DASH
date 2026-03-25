import { campaignStatusAllowsAutoSend, getCampaignRuntimeState } from '@/lib/campaign-guard.js';
import { DEFAULT_SEND_EMAIL_INTERVAL_MIN, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

function toPositiveInt(value, fallback, { min = 1, max = 1440 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isSameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function alignToSlotAtOrAfter(targetMs, baseSlotMs, intervalMs) {
  if (targetMs <= baseSlotMs) return baseSlotMs;
  return baseSlotMs + Math.ceil((targetMs - baseSlotMs) / intervalMs) * intervalMs;
}

function compareQueueRows(left, right) {
  const leftMs = parseDateMs(left.next_run_at) ?? 0;
  const rightMs = parseDateMs(right.next_run_at) ?? 0;
  if (leftMs !== rightMs) return leftMs - rightMs;
  return String(left.id || '').localeCompare(String(right.id || ''));
}

export function resolveSendEmailIntervalMin(settings = {}) {
  const normalized = normalizeStoredCampaignSettings(settings);
  return toPositiveInt(normalized.send_email_interval_min, DEFAULT_SEND_EMAIL_INTERVAL_MIN, { min: 1, max: 1440 });
}

export function resolveSendBatchLimit(settings = {}) {
  const normalized = normalizeStoredCampaignSettings(settings);
  return toPositiveInt(
    normalized.send_batch_limit ?? normalized.sendBatchLimit ?? normalized.send_limit ?? normalized.sendLimit,
    1,
    { min: 1, max: 200 },
  );
}

export function projectQueueRows(rows = [], { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.campaign_id || 'no_campaign');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const projected = [];

  for (const campaignRows of grouped.values()) {
    const sortedRows = [...campaignRows].sort(compareQueueRows);
    const settings = normalizeStoredCampaignSettings(sortedRows[0]?.campaign_settings || {});
    const runtime = getCampaignRuntimeState(settings);
    const intervalMin = resolveSendEmailIntervalMin(settings);
    const intervalMs = intervalMin * 60 * 1000;
    const batchLimit = resolveSendBatchLimit(settings);
    const nextExpectedSendMs = parseDateMs(runtime.next_expected_send_at);
    const lastAutoSendMs = parseDateMs(runtime.last_auto_send_at);
    const baseSlotMs = nextExpectedSendMs !== null
      ? Math.max(nowMs, nextExpectedSendMs)
      : (
        lastAutoSendMs !== null
          ? Math.max(nowMs, lastAutoSendMs + intervalMs)
          : nowMs
      );
    const sendEnabled = runtime.auto_send_enabled && campaignStatusAllowsAutoSend(sortedRows[0]?.campaign_status);

    let slotMs = baseSlotMs;
    let usedInSlot = 0;

    for (const row of sortedRows) {
      const readyMs = parseDateMs(row.next_run_at);
      let projectedSendMs = null;
      let queueSlotNo = null;

      if (sendEnabled) {
        if (usedInSlot >= batchLimit) {
          slotMs += intervalMs;
          usedInSlot = 0;
        }

        if (readyMs !== null && readyMs > slotMs) {
          slotMs = alignToSlotAtOrAfter(readyMs, baseSlotMs, intervalMs);
          usedInSlot = 0;
        }

        projectedSendMs = slotMs;
        queueSlotNo = Math.max(1, Math.floor((projectedSendMs - baseSlotMs) / intervalMs) + 1);
        usedInSlot += 1;
      }

      projected.push({
        ...row,
        campaign_settings: settings,
        ready_at: row.next_run_at,
        projected_send_at: projectedSendMs === null ? null : new Date(projectedSendMs).toISOString(),
        send_email_interval_min: intervalMin,
        send_batch_limit: batchLimit,
        next_scheduler_slot_at: sendEnabled ? new Date(baseSlotMs).toISOString() : null,
        queue_slot_no: queueSlotNo,
        ready_now: readyMs === null ? true : readyMs <= nowMs,
        send_scheduler_enabled: sendEnabled,
      });
    }
  }

  return projected.sort((left, right) => {
    const leftSendMs = parseDateMs(left.projected_send_at);
    const rightSendMs = parseDateMs(right.projected_send_at);
    if (leftSendMs !== null && rightSendMs !== null && leftSendMs !== rightSendMs) return leftSendMs - rightSendMs;
    if (leftSendMs !== null && rightSendMs === null) return -1;
    if (leftSendMs === null && rightSendMs !== null) return 1;

    const leftReadyMs = parseDateMs(left.ready_at) ?? 0;
    const rightReadyMs = parseDateMs(right.ready_at) ?? 0;
    if (leftReadyMs !== rightReadyMs) return leftReadyMs - rightReadyMs;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function filterProjectedQueueRows(rows = [], due = 'all', { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const next24hMs = nowMs + 24 * 60 * 60 * 1000;

  return rows.filter((row) => {
    if (due === 'all') return true;
    if (due === 'overdue') return Boolean(row.ready_now);

    const sendMs = parseDateMs(row.projected_send_at);
    if (sendMs === null) return false;

    if (due === 'today') return isSameLocalDay(new Date(sendMs), now);
    if (due === 'next24h') return sendMs > nowMs && sendMs <= next24hMs;
    return true;
  });
}

export function summarizeProjectedQueue(rows = [], { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const next24hMs = nowMs + 24 * 60 * 60 * 1000;
  const sendEtas = rows
    .map((row) => parseDateMs(row.projected_send_at))
    .filter((value) => value !== null)
    .sort((left, right) => left - right);

  return {
    total: rows.length,
    ready_now: rows.filter((row) => row.ready_now).length,
    next_24h: sendEtas.filter((value) => value > nowMs && value <= next24hMs).length,
    next_eta: sendEtas.length > 0 ? new Date(sendEtas[0]).toISOString() : null,
  };
}
