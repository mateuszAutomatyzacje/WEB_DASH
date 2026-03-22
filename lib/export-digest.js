import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import { logApplicationEventSafe } from '@/lib/application-logs.js';
import {
  buildLeadExportXlsHtml,
  getLeadExportHeaders,
  listLeadExportRows,
  mapLeadExportRow,
  normalizeLeadExportFilters,
} from '@/lib/lead-export.js';
import {
  DEFAULT_LOCAL_TIMEZONE,
  getLocalDateTimeParts,
  parseTimeValue,
  toLocalSeconds,
} from '@/lib/local-schedule.js';

const RUN_LOCK_NAMESPACE = 'webdash_lead_export_digest_v1';
const DEFAULT_RECIPIENT_EMAIL = 'piotr.chabros@staffinit.com';
const DEFAULT_WEBHOOK_URL = 'https://primary-production-03aa0.up.railway.app/webhook/4e3a2700-fe1e-4853-9782-053de039de34';
const DEFAULT_SEND_AT = '08:00:00';
const DEFAULT_TIMEZONE = DEFAULT_LOCAL_TIMEZONE;
const DEFAULT_EXPORT_LIMIT = 5000;
const DEFAULT_SCOPE = 'campaign_contacts';
const DEFAULT_EMAIL_FILTER = 'with_email';
const DEFAULT_UPDATED_WINDOW = 'all';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeInt(value, fallback, { min = 1, max = 10000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.trunc(numeric), max));
}

function normalizeUuid(value) {
  const raw = String(value || '').trim();
  return /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : null;
}

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getDigestConfig() {
  return {
    recipientEmail: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_RECIPIENT, DEFAULT_RECIPIENT_EMAIL),
    webhookUrl: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_WEBHOOK_URL, DEFAULT_WEBHOOK_URL),
    webhookToken: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_WEBHOOK_TOKEN, ''),
    timeZone: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_TIMEZONE, DEFAULT_TIMEZONE),
    sendAtLocal: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_SEND_AT_LOCAL, DEFAULT_SEND_AT),
    campaignId: normalizeUuid(process.env.WEBDASH_EXPORT_DIGEST_CAMPAIGN_ID),
    campaignName: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_CAMPAIGN_NAME, DEFAULT_EVERGREEN_NAME),
    scope: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_SCOPE, DEFAULT_SCOPE),
    email: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_EMAIL_FILTER, DEFAULT_EMAIL_FILTER),
    updated: normalizeText(process.env.WEBDASH_EXPORT_DIGEST_UPDATED_WINDOW, DEFAULT_UPDATED_WINDOW),
    limit: normalizeInt(process.env.WEBDASH_EXPORT_DIGEST_LIMIT, DEFAULT_EXPORT_LIMIT, { min: 1, max: 10000 }),
  };
}

function dailyRunKey(dateLabel, recipientEmail) {
  return `daily:${dateLabel}:${recipientEmail.toLowerCase()}`;
}

function buildAttachmentFilename() {
  return `lead-export-${new Date().toISOString().slice(0, 10)}.xls`;
}

function buildEmailSubject(rowCount) {
  return `[WebDash] New leads export (${rowCount})`;
}

function buildEmailBody({ rowCount, recipientEmail, generatedAt, campaignName, scope }) {
  return [
    `Hi,`,
    '',
    `Attached is the latest WebDash lead export with ${rowCount} new records.`,
    '',
    `Recipient: ${recipientEmail}`,
    `Campaign: ${campaignName || 'all campaigns'}`,
    `Scope: ${scope}`,
    `Generated at: ${generatedAt}`,
    '',
    'This delivery contains only records that have not been exported before to this digest recipient.',
  ].join('\n');
}

async function ensureExportDigestStorage(sql) {
  await sql`
    create table if not exists public.lead_export_runs (
      id uuid primary key default gen_random_uuid(),
      run_key text,
      run_kind text not null default 'scheduled',
      recipient_email text not null,
      campaign_id uuid,
      campaign_name text,
      scope text not null,
      email_filter text not null default 'with_email',
      updated_window text not null default 'all',
      status text not null,
      record_count int not null default 0,
      attachment_filename text,
      webhook_url text,
      error text,
      details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `;
  await sql`
    create table if not exists public.lead_export_dispatches (
      id uuid primary key default gen_random_uuid(),
      run_id uuid references public.lead_export_runs(id) on delete set null,
      recipient_email text not null,
      lead_id uuid not null,
      lead_contact_id uuid not null,
      campaign_id uuid,
      delivered_at timestamptz not null default now(),
      details jsonb not null default '{}'::jsonb,
      constraint lead_export_dispatches_unique unique (recipient_email, lead_id, lead_contact_id)
    )
  `;
  await sql`create index if not exists idx_lead_export_runs_created_at on public.lead_export_runs(created_at desc)`;
  await sql`create index if not exists idx_lead_export_runs_recipient_created_at on public.lead_export_runs(recipient_email, created_at desc)`;
  await sql`create index if not exists idx_lead_export_dispatches_recipient_delivered_at on public.lead_export_dispatches(recipient_email, delivered_at desc)`;
}

async function resolveConfiguredCampaign(sql, config) {
  if (config.campaignId) {
    const byId = await sql`
      select id, name, status::text as status
      from public.campaigns
      where id = ${config.campaignId}::uuid
      limit 1
    `;
    if (byId[0]) return byId[0];
  }

  if (config.campaignName) {
    const byName = await sql`
      select id, name, status::text as status
      from public.campaigns
      where name = ${config.campaignName}
      order by created_at desc
      limit 1
    `;
    if (byName[0]) return byName[0];
  }

  return null;
}

async function resolveDigestFilters(sql, config) {
  const campaign = await resolveConfiguredCampaign(sql, config);
  const filters = normalizeLeadExportFilters({
    campaign_id: campaign?.id || 'all',
    scope: config.scope,
    email: config.email,
    updated: config.updated,
    limit: config.limit,
  }, {
    defaultCampaignId: campaign?.id || 'all',
    defaultLimit: config.limit,
  });

  return {
    filters,
    campaign,
  };
}

async function listPendingDigestRows(sql, { config, filters, limit = null } = {}) {
  const rows = await listLeadExportRows(sql, filters, { limit: limit || config.limit });
  if (!rows.length) return [];

  const recipientEmail = config.recipientEmail;
  const leadIds = [...new Set(rows.map((row) => row.lead_id).filter(Boolean))];
  const contactIds = [...new Set(rows.map((row) => row.lead_contact_id).filter(Boolean))];

  const delivered = await sql`
    select lead_id, lead_contact_id
    from public.lead_export_dispatches
    where recipient_email = ${recipientEmail}
      and lead_id = any(${leadIds}::uuid[])
      and lead_contact_id = any(${contactIds}::uuid[])
  `;

  const deliveredSet = new Set(delivered.map((row) => `${row.lead_id}:${row.lead_contact_id}`));
  return rows.filter((row) => !deliveredSet.has(`${row.lead_id}:${row.lead_contact_id}`));
}

function buildAttachmentPayload(rows, generatedAt) {
  const filename = buildAttachmentFilename();
  const html = buildLeadExportXlsHtml(rows, generatedAt);
  const base64 = Buffer.from(html, 'utf8').toString('base64');

  return {
    filename,
    contentType: 'application/vnd.ms-excel',
    contentBase64: base64,
    html,
  };
}

async function triggerExportDigestWebhook(payload, { webhookUrl, token }) {
  if (!webhookUrl) throw new Error('Missing export digest webhook URL');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(token ? { token, ...payload } : payload),
    cache: 'no-store',
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || json?.message || `Export digest webhook HTTP ${res.status}`);
  }

  return {
    status: res.status,
    response: json,
    webhook_url: webhookUrl,
  };
}

async function withDigestLock(sql, recipientEmail, fn) {
  const reserved = typeof sql.reserve === 'function' ? await sql.reserve() : sql;
  const shouldRelease = reserved !== sql && typeof reserved.release === 'function';

  try {
    const lockRows = await reserved`
      select pg_try_advisory_lock(hashtext(${RUN_LOCK_NAMESPACE}), hashtext(${String(recipientEmail)})) as locked
    `;
    const locked = Boolean(lockRows[0]?.locked);
    if (!locked) return { locked: false, result: null };

    try {
      return { locked: true, result: await fn(reserved) };
    } finally {
      await reserved`
        select pg_advisory_unlock(hashtext(${RUN_LOCK_NAMESPACE}), hashtext(${String(recipientEmail)}))
      `;
    }
  } finally {
    if (shouldRelease) await reserved.release();
  }
}

function getTodayRunState(date = new Date(), timeZone = DEFAULT_TIMEZONE, sendAtLocal = DEFAULT_SEND_AT) {
  const sendAt = parseTimeValue(sendAtLocal, DEFAULT_SEND_AT);
  const local = getLocalDateTimeParts(date, timeZone);
  const currentSeconds = toLocalSeconds(local);
  const sendAtSeconds = toLocalSeconds(sendAt);

  return {
    local,
    sendAt,
    dueToday: currentSeconds >= sendAtSeconds,
    dateLabel: local.date_label,
  };
}

function getNextScheduledDigestAt(date = new Date(), timeZone = DEFAULT_TIMEZONE, sendAtLocal = DEFAULT_SEND_AT) {
  const probe = new Date(date);
  for (let i = 0; i < 3 * 24 * 60; i += 1) {
    const local = getLocalDateTimeParts(probe, timeZone);
    const sendAt = parseTimeValue(sendAtLocal, DEFAULT_SEND_AT);
    if (
      local.hour === sendAt.hour
      && local.minute === sendAt.minute
      && local.second === sendAt.second
      && probe.getTime() >= date.getTime()
    ) {
      return probe.toISOString();
    }
    probe.setUTCMinutes(probe.getUTCMinutes() + 1, 0, 0);
  }
  return null;
}

async function getLatestDigestRun(sql, recipientEmail) {
  const rows = await sql`
    select
      id,
      run_key,
      run_kind,
      recipient_email,
      campaign_id,
      campaign_name,
      scope,
      email_filter,
      updated_window,
      status,
      record_count,
      attachment_filename,
      webhook_url,
      error,
      details,
      created_at,
      completed_at
    from public.lead_export_runs
    where recipient_email = ${recipientEmail}
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

async function hasScheduledRunForToday(sql, recipientEmail, runKey) {
  const rows = await sql`
    select id, status, created_at, completed_at
    from public.lead_export_runs
    where recipient_email = ${recipientEmail}
      and run_key = ${runKey}
      and run_kind = 'scheduled'
      and status in ('sent', 'no_new_records')
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function getLeadExportDigestStatus(sql, { now = new Date() } = {}) {
  await ensureExportDigestStorage(sql);
  const config = getDigestConfig();
  const { filters, campaign } = await resolveDigestFilters(sql, config);
  const pendingRows = await listPendingDigestRows(sql, { config, filters, limit: 5000 });
  const latestRun = await getLatestDigestRun(sql, config.recipientEmail);
  const nextScheduledAt = getNextScheduledDigestAt(now, config.timeZone, config.sendAtLocal);

  return {
    config: {
      ...config,
      campaignId: campaign?.id || null,
      campaignName: campaign?.name || config.campaignName || null,
    },
    filters,
    pending_count: pendingRows.length,
    latest_run: latestRun,
    next_scheduled_at: nextScheduledAt,
  };
}

export async function getLeadExportDigestTickState(sql, { now = new Date() } = {}) {
  await ensureExportDigestStorage(sql);
  const config = getDigestConfig();
  const { filters, campaign } = await resolveDigestFilters(sql, config);
  const today = getTodayRunState(now, config.timeZone, config.sendAtLocal);
  const runKey = dailyRunKey(today.dateLabel, config.recipientEmail);
  const existingToday = await hasScheduledRunForToday(sql, config.recipientEmail, runKey);
  const pendingRows = today.dueToday ? await listPendingDigestRows(sql, { config, filters, limit: 5000 }) : [];

  return {
    ok: true,
    skipped: !today.dueToday || Boolean(existingToday),
    reason: existingToday ? 'already_sent_today' : (today.dueToday ? null : 'before_send_window'),
    config: {
      ...config,
      campaignId: campaign?.id || null,
      campaignName: campaign?.name || config.campaignName || null,
    },
    filters,
    pending_count: pendingRows.length,
    run_key: runKey,
    next_scheduled_at: getNextScheduledDigestAt(now, config.timeZone, config.sendAtLocal),
  };
}

export async function runLeadExportDigest(sql, {
  manual = false,
  test = false,
  source = 'export_digest',
} = {}) {
  await ensureExportDigestStorage(sql);
  const config = getDigestConfig();

  if (!config.recipientEmail) throw new Error('Missing export digest recipient email');
  if (!config.webhookUrl) throw new Error('Missing export digest webhook URL');

  const lockResult = await withDigestLock(sql, config.recipientEmail, async (lockedSql) => {
    const { filters, campaign } = await resolveDigestFilters(lockedSql, config);
    const now = new Date();
    const today = getTodayRunState(now, config.timeZone, config.sendAtLocal);
    const runKey = dailyRunKey(today.dateLabel, config.recipientEmail);

    if (!manual) {
      const existingToday = await hasScheduledRunForToday(lockedSql, config.recipientEmail, runKey);
      if (existingToday) {
        return {
          ok: true,
          skipped: true,
          reason: 'already_sent_today',
          run_key: runKey,
          pending_count: 0,
        };
      }
      if (!today.dueToday) {
        return {
          ok: true,
          skipped: true,
          reason: 'before_send_window',
          run_key: runKey,
          pending_count: 0,
          next_scheduled_at: getNextScheduledDigestAt(now, config.timeZone, config.sendAtLocal),
        };
      }
    }

    const pendingRows = await listPendingDigestRows(lockedSql, { config, filters, limit: config.limit });
    const generatedAt = now.toISOString();
    const runRows = await lockedSql`
      insert into public.lead_export_runs (
        run_key,
        run_kind,
        recipient_email,
        campaign_id,
        campaign_name,
        scope,
        email_filter,
        updated_window,
        status,
        record_count,
        webhook_url,
        details,
        created_at
      )
      values (
        ${manual ? null : runKey},
        ${test ? 'test' : (manual ? 'manual' : 'scheduled')},
        ${config.recipientEmail},
        ${campaign?.id || null}::uuid,
        ${campaign?.name || config.campaignName || null},
        ${filters.scope},
        ${filters.email},
        ${filters.updated},
        ${pendingRows.length > 0 ? 'running' : 'no_new_records'},
        ${pendingRows.length},
        ${config.webhookUrl},
        ${lockedSql.json({
          time_zone: config.timeZone,
          send_at_local: config.sendAtLocal,
          generated_at: generatedAt,
        })}::jsonb,
        now()
      )
      returning id
    `;
    const runId = runRows[0]?.id || null;

    try {
      if (pendingRows.length === 0) {
        await lockedSql`
          update public.lead_export_runs
          set completed_at = now()
          where id = ${runId}::uuid
        `;
        await logApplicationEventSafe(lockedSql, {
          level: 'info',
          scope: 'export',
          source,
          eventType: 'lead_export_digest_no_new_records',
          message: `Lead export digest skipped for ${config.recipientEmail}: no new records.`,
          details: {
            recipient_email: config.recipientEmail,
            campaign_name: campaign?.name || config.campaignName || null,
            run_kind: test ? 'test' : (manual ? 'manual' : 'scheduled'),
          },
        });
        return {
          ok: true,
          skipped: true,
          reason: 'no_new_records',
          run_id: runId,
          pending_count: 0,
        };
      }

      const rowsForSend = test && pendingRows.length === 0
        ? await listLeadExportRows(lockedSql, filters, { limit: Math.min(config.limit, 100) })
        : pendingRows;
      if (rowsForSend.length === 0) {
        await lockedSql`
          update public.lead_export_runs
          set
            status = 'no_new_records',
            completed_at = now()
          where id = ${runId}::uuid
        `;
        return {
          ok: true,
          skipped: true,
          reason: 'no_test_rows',
          run_id: runId,
          pending_count: 0,
        };
      }

      const attachment = buildAttachmentPayload(rowsForSend, generatedAt);
      const mappedRows = rowsForSend.map(mapLeadExportRow);
      const subject = buildEmailSubject(mappedRows.length);
      const body = buildEmailBody({
        rowCount: mappedRows.length,
        recipientEmail: config.recipientEmail,
        generatedAt,
        campaignName: campaign?.name || config.campaignName || null,
        scope: filters.scope,
      });

      const webhook = await triggerExportDigestWebhook({
        mode: test ? 'lead_export_digest_test' : 'lead_export_digest',
        to_email: config.recipientEmail,
        recipient_email: config.recipientEmail,
        subject,
        body,
        attachment_filename: attachment.filename,
        attachment_content_type: attachment.contentType,
        attachment_content_base64: attachment.contentBase64,
        attachment_html: attachment.html,
        attachments: [
          {
            filename: attachment.filename,
            content_type: attachment.contentType,
            content_base64: attachment.contentBase64,
          },
        ],
        rows: mappedRows,
        count: mappedRows.length,
        generated_at: generatedAt,
        campaign_name: campaign?.name || config.campaignName || null,
        scope: filters.scope,
        email_filter: filters.email,
        updated_window: filters.updated,
        headers: getLeadExportHeaders(),
        webdash_export_digest: true,
        test_send: test,
      }, {
        webhookUrl: config.webhookUrl,
        token: config.webhookToken || null,
      });

      if (!test) {
        for (const row of rowsForSend) {
          await lockedSql`
            insert into public.lead_export_dispatches (
              run_id,
              recipient_email,
              lead_id,
              lead_contact_id,
              campaign_id,
              delivered_at,
              details
            )
            values (
              ${runId}::uuid,
              ${config.recipientEmail},
              ${row.lead_id}::uuid,
              ${row.lead_contact_id}::uuid,
              ${row.campaign_id || null}::uuid,
              now(),
              ${lockedSql.json({
                campaign_name: row.campaign_name || null,
                company_name: row.company_name || null,
                developer_needed: row.developer_needed || null,
              })}::jsonb
            )
            on conflict (recipient_email, lead_id, lead_contact_id) do nothing
          `;
        }
      }

      await lockedSql`
        update public.lead_export_runs
        set
          status = ${test ? 'test_sent' : 'sent'},
          record_count = ${rowsForSend.length},
          attachment_filename = ${attachment.filename},
          completed_at = now(),
          details = coalesce(details, '{}'::jsonb) || ${lockedSql.json({
            webhook_status: webhook.status,
            webhook_url: webhook.webhook_url,
            generated_at: generatedAt,
            test_send: test,
          })}::jsonb
        where id = ${runId}::uuid
      `;

      await logApplicationEventSafe(lockedSql, {
        level: 'success',
        scope: 'export',
        source,
        eventType: test ? 'lead_export_digest_test_sent' : 'lead_export_digest_sent',
        message: `${test ? 'Lead export test' : 'Lead export digest'} sent to ${config.recipientEmail}. rows=${rowsForSend.length}.`,
        details: {
          recipient_email: config.recipientEmail,
          row_count: rowsForSend.length,
          campaign_name: campaign?.name || config.campaignName || null,
          webhook_url: webhook.webhook_url,
          attachment_filename: attachment.filename,
          run_kind: test ? 'test' : (manual ? 'manual' : 'scheduled'),
        },
      });

      return {
        ok: true,
        skipped: false,
        run_id: runId,
        row_count: rowsForSend.length,
        recipient_email: config.recipientEmail,
        webhook_url: webhook.webhook_url,
        attachment_filename: attachment.filename,
        rows: mappedRows,
        test_send: test,
      };
    } catch (error) {
      await lockedSql`
        update public.lead_export_runs
        set
          status = 'failed',
          error = ${String(error?.message || error)},
          completed_at = now()
        where id = ${runId}::uuid
      `;
      await logApplicationEventSafe(lockedSql, {
        level: 'error',
        scope: 'export',
        source,
        eventType: 'lead_export_digest_failed',
        message: `Lead export digest failed for ${config.recipientEmail}: ${String(error?.message || error)}`,
        details: {
          recipient_email: config.recipientEmail,
          campaign_name: campaign?.name || config.campaignName || null,
          run_kind: test ? 'test' : (manual ? 'manual' : 'scheduled'),
          error: String(error?.message || error),
        },
      });
      throw error;
    }
  });

  if (!lockResult.locked) {
    return {
      ok: true,
      skipped: true,
      reason: 'locked',
    };
  }

  return lockResult.result;
}
