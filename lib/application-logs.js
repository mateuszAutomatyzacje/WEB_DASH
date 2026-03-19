const GLOBAL_KEY = '__WEBDASH_APP_RUNTIME_LOGS__';

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      ready: false,
      ensuring: null,
    };
  }
  return globalThis[GLOBAL_KEY];
}

function toSafeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value == null ? {} : { value };
  }
  return value;
}

function parseDateMs(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function toneFromDeliveryEvent(eventType) {
  if (eventType === 'failed' || eventType === 'bounced' || eventType === 'complained' || eventType === 'unsubscribed') return 'error';
  if (eventType === 'sent' || eventType === 'delivered' || eventType === 'replied') return 'success';
  if (eventType === 'queued') return 'info';
  return 'info';
}

function renderContact(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.target_email || '-';
}

function renderDeliveryMessage(row) {
  const eventType = String(row.event_type || 'event');
  const contact = renderContact(row);
  const company = row.company_name ? ` at ${row.company_name}` : '';
  const attempt = row.attempt_no && row.attempt_no !== '-' ? ` #${row.attempt_no}` : '';
  const target = row.target_email && row.target_email !== '-' ? ` <${row.target_email}>` : '';

  if (eventType === 'sent') {
    return `Email attempt${attempt} sent to ${contact}${target}${company}.`;
  }
  if (eventType === 'failed') {
    return `Email attempt${attempt} failed for ${contact}${target}${company}: ${row.error || 'unknown error'}.`;
  }
  if (eventType === 'replied') {
    return `Reply received from ${contact}${target}${company}.`;
  }
  if (eventType === 'bounced') {
    return `Bounce reported for ${contact}${target}${company}.`;
  }
  if (eventType === 'complained') {
    return `Complaint reported for ${contact}${target}${company}.`;
  }
  if (eventType === 'unsubscribed') {
    return `${contact}${target}${company} unsubscribed.`;
  }
  if (eventType === 'queued') {
    return `Email attempt${attempt} queued for ${contact}${target}${company}.`;
  }
  return `Delivery event ${eventType} for ${contact}${target}${company}.`;
}

function mapRuntimeLog(row) {
  return {
    id: `runtime:${row.id}`,
    created_at: row.created_at,
    level: row.level || 'info',
    scope: row.scope || 'app',
    source: row.source || '-',
    event_type: row.event_type || 'runtime_event',
    message: row.message || '-',
    campaign_id: row.campaign_id || null,
    campaign_name: row.campaign_name || null,
    lead_id: row.lead_id || null,
    lead_contact_id: row.lead_contact_id || null,
    message_attempt_id: row.message_attempt_id || null,
    company_name: row.details?.company_name || null,
    contact_name: row.details?.contact_name || null,
    target_email: row.details?.target_email || null,
    sequence_step: row.details?.sequence_step || null,
    provider: row.details?.provider || null,
    provider_message_id: row.details?.provider_message_id || null,
    error: row.details?.error || null,
    details: row.details || {},
    kind: 'runtime',
  };
}

function mapDeliveryLog(row) {
  return {
    id: `delivery:${row.id}`,
    created_at: row.created_at,
    level: toneFromDeliveryEvent(row.event_type),
    scope: 'delivery',
    source: row.source || 'message_event',
    event_type: row.event_type || 'delivery_event',
    message: renderDeliveryMessage(row),
    campaign_id: row.campaign_id || null,
    campaign_name: row.campaign_name || null,
    lead_id: row.lead_id || null,
    lead_contact_id: row.lead_contact_id || null,
    message_attempt_id: row.message_attempt_id || null,
    company_name: row.company_name || null,
    contact_name: renderContact(row),
    target_email: row.target_email || null,
    sequence_step: row.sequence_step || null,
    provider: row.provider || null,
    provider_message_id: row.provider_message_id || null,
    error: row.error && row.error !== '-' ? row.error : null,
    details: {
      subject: row.subject || null,
      attempt_no: row.attempt_no || null,
      provider: row.provider || null,
      provider_message_id: row.provider_message_id || null,
      sequence_step: row.sequence_step || null,
      error: row.error && row.error !== '-' ? row.error : null,
    },
    kind: 'delivery',
  };
}

export async function ensureApplicationLogStorage(sql) {
  const state = getState();
  if (state.ready) return;
  if (state.ensuring) {
    await state.ensuring;
    return;
  }

  state.ensuring = (async () => {
    await sql`
      create table if not exists public.app_runtime_logs (
        id uuid primary key default gen_random_uuid(),
        level text not null default 'info',
        scope text not null default 'app',
        source text,
        event_type text not null,
        message text not null,
        campaign_id uuid,
        campaign_name text,
        lead_id uuid,
        lead_contact_id uuid,
        message_attempt_id uuid,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `;

    await sql`create index if not exists idx_app_runtime_logs_created_at on public.app_runtime_logs(created_at desc)`;
    await sql`create index if not exists idx_app_runtime_logs_scope_created_at on public.app_runtime_logs(scope, created_at desc)`;
    await sql`create index if not exists idx_app_runtime_logs_campaign_created_at on public.app_runtime_logs(campaign_id, created_at desc)`;
    state.ready = true;
  })();

  try {
    await state.ensuring;
  } finally {
    state.ensuring = null;
  }
}

export async function logApplicationEvent(sql, {
  level = 'info',
  scope = 'app',
  source = null,
  eventType = 'runtime_event',
  message,
  campaignId = null,
  campaignName = null,
  leadId = null,
  leadContactId = null,
  messageAttemptId = null,
  details = {},
} = {}) {
  if (!message) throw new Error('logApplicationEvent requires message');
  await ensureApplicationLogStorage(sql);

  await sql`
    insert into public.app_runtime_logs (
      level,
      scope,
      source,
      event_type,
      message,
      campaign_id,
      campaign_name,
      lead_id,
      lead_contact_id,
      message_attempt_id,
      details,
      created_at
    )
    values (
      ${String(level || 'info')},
      ${String(scope || 'app')},
      ${source ? String(source) : null},
      ${String(eventType || 'runtime_event')},
      ${String(message)},
      ${campaignId || null}::uuid,
      ${campaignName ? String(campaignName) : null},
      ${leadId || null}::uuid,
      ${leadContactId || null}::uuid,
      ${messageAttemptId || null}::uuid,
      ${sql.json(toSafeObject(details))}::jsonb,
      now()
    )
  `;
}

export async function logApplicationEventSafe(sql, payload = {}) {
  try {
    await logApplicationEvent(sql, payload);
  } catch (error) {
    console.error('[webdash:app-log] failed to persist runtime log:', error);
  }
}

export async function listApplicationLogEntries(sql, { limit = 160 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit || 160), 1), 500);
  await ensureApplicationLogStorage(sql);

  const [runtimeRows, deliveryRows] = await Promise.all([
    sql`
      select
        id,
        created_at,
        level,
        scope,
        source,
        event_type,
        message,
        campaign_id,
        campaign_name,
        lead_id,
        lead_contact_id,
        message_attempt_id,
        details
      from public.app_runtime_logs
      order by created_at desc
      limit ${safeLimit}
    `,
    sql`
      select
        me.id,
        me.created_at,
        me.event_type::text as event_type,
        coalesce(me.event_meta->>'source', 'message_event') as source,
        coalesce(me.event_meta->>'sequence_step', '-') as sequence_step,
        coalesce(me.event_meta->>'attempt_no', '-') as attempt_no,
        coalesce(me.event_meta->>'to', ma.to_email::text, lc.email::text, '-') as target_email,
        coalesce(me.event_meta->>'provider', ma.provider, '-') as provider,
        coalesce(me.event_meta->>'provider_message_id', ma.provider_message_id, '-') as provider_message_id,
        coalesce(me.event_meta->>'error', '-') as error,
        ma.id as message_attempt_id,
        ma.lead_id,
        ma.lead_contact_id,
        c.id as campaign_id,
        c.name as campaign_name,
        l.company_name,
        lc.first_name,
        lc.last_name,
        case
          when coalesce(me.event_meta->>'attempt_no', '1') = '2' then coalesce(ma.follow_up_1_subject, ma.subject)
          when coalesce(me.event_meta->>'attempt_no', '1') = '3' then coalesce(ma.follow_up_2_subject, ma.subject)
          else ma.subject
        end as subject
      from public.message_events me
      join public.message_attempts ma on ma.id = me.message_attempt_id
      left join public.campaigns c on c.id = ma.campaign_id
      left join public.leads l on l.id = ma.lead_id
      left join public.lead_contacts lc on lc.id = ma.lead_contact_id
      order by me.created_at desc
      limit ${safeLimit}
    `,
  ]);

  return [...runtimeRows.map(mapRuntimeLog), ...deliveryRows.map(mapDeliveryLog)]
    .sort((left, right) => parseDateMs(right.created_at) - parseDateMs(left.created_at))
    .slice(0, safeLimit);
}

export function summarizeApplicationLogEntries(entries = []) {
  const summary = {
    total: 0,
    errors: 0,
    warnings: 0,
    delivery: 0,
    runtime: 0,
  };

  for (const entry of entries) {
    summary.total += 1;
    if (entry.kind === 'delivery') summary.delivery += 1;
    if (entry.kind === 'runtime') summary.runtime += 1;
    if (entry.level === 'error') summary.errors += 1;
    if (entry.level === 'warn' || entry.level === 'warning') summary.warnings += 1;
  }

  return summary;
}
