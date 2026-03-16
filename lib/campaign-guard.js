import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

const DEFAULT_FOLLOW_UP_DELAY_DAYS = 3;
const DEFAULT_SYNC_INTERVAL_MIN = 10;
const DEFAULT_SEND_LIMIT = 25;

function normalizeCampaignRow(row) {
  if (!row) return null;
  return {
    ...row,
    settings: normalizeStoredCampaignSettings(row.settings),
  };
}

function toPositiveInt(value, fallback, { min = 1, max = 365 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getSequenceConfig(settings = {}) {
  const normalized = normalizeStoredCampaignSettings(settings);
  const sharedDelay = toPositiveInt(normalized.follow_up_delay_days, DEFAULT_FOLLOW_UP_DELAY_DAYS, { min: 1, max: 30 });

  return {
    followUp1DelayDays: toPositiveInt(normalized.follow_up_1_delay_days, sharedDelay, { min: 1, max: 30 }),
    followUp2DelayDays: toPositiveInt(normalized.follow_up_2_delay_days, sharedDelay, { min: 1, max: 30 }),
    syncIntervalMin: toPositiveInt(
      normalized.sync_interval_min ?? normalized.send_interval_min,
      DEFAULT_SYNC_INTERVAL_MIN,
      { min: 1, max: 1440 },
    ),
  };
}

function getStepKey(attemptNo) {
  if (attemptNo === 1) return 'main';
  if (attemptNo === 2) return 'follow_up_1';
  if (attemptNo === 3) return 'follow_up_2';
  return 'unknown';
}

function getNextAttemptPlan(item, settings = {}) {
  const config = getSequenceConfig(settings);
  const attemptNo = Number(item?.contact_attempt_no || 1);

  if (attemptNo === 1) {
    return {
      nextAttemptNo: 2,
      nextRunAt: item?.follow_up_1_scheduled_at || addDays(config.followUp1DelayDays),
      stopAfterSend: false,
    };
  }

  if (attemptNo === 2) {
    return {
      nextAttemptNo: 3,
      nextRunAt: item?.follow_up_2_scheduled_at || addDays(config.followUp2DelayDays),
      stopAfterSend: false,
    };
  }

  return {
    nextAttemptNo: 4,
    nextRunAt: null,
    stopAfterSend: true,
  };
}

function buildDefaultCampaignSettings(source) {
  return {
    mode: 'evergreen',
    auto_enqueue: true,
    auto_sync_enabled: true,
    auto_sync_status: 'running',
    auto_send_enabled: true,
    auto_send_status: 'running',
    sync_interval_min: DEFAULT_SYNC_INTERVAL_MIN,
    source,
  };
}

function buildOutboxPreview(rows = []) {
  return rows.map((row) => ({
    campaign_lead_id: row.campaign_lead_id,
    message_attempt_id: row.message_attempt_id,
    to_email: row.to_email,
    send_subject: row.send_subject,
    send_body_preview: typeof row.send_body === 'string' ? row.send_body.slice(0, 120) : null,
    lead_id: row.lead_id,
    lead_contact_id: row.lead_contact_id,
    contact_attempt_no: row.contact_attempt_no,
    step_key: getStepKey(Number(row.contact_attempt_no || 1)),
    next_run_at: row.next_run_at,
  }));
}

async function persistAttemptTelemetry(sql, item, { providerMessageId = null, providerName = null, stepState = 'sent', nextRunAt = null } = {}) {
  const attemptNo = Number(item?.contact_attempt_no || 1);

  if (attemptNo === 1) {
    await sql`
      update public.message_attempts
      set
        campaign_id = ${item.campaign_id}::uuid,
        provider = coalesce(${providerName}, provider),
        provider_message_id = coalesce(${providerMessageId}, provider_message_id),
        sent_at = coalesce(sent_at, now()),
        follow_up_1_status = case
          when ${nextRunAt}::timestamptz is not null then 'scheduled'
          else follow_up_1_status
        end,
        follow_up_1_scheduled_at = coalesce(follow_up_1_scheduled_at, ${nextRunAt}::timestamptz)
      where id = ${item.message_attempt_id}::uuid
    `;
    return;
  }

  if (attemptNo === 2) {
    await sql`
      update public.message_attempts
      set
        campaign_id = ${item.campaign_id}::uuid,
        provider = coalesce(${providerName}, provider),
        provider_message_id = coalesce(${providerMessageId}, provider_message_id),
        follow_up_1_status = ${stepState},
        follow_up_1_sent_at = case
          when ${stepState} = 'sent' then coalesce(follow_up_1_sent_at, now())
          else follow_up_1_sent_at
        end,
        follow_up_2_status = case
          when ${nextRunAt}::timestamptz is not null then 'scheduled'
          else follow_up_2_status
        end,
        follow_up_2_scheduled_at = coalesce(follow_up_2_scheduled_at, ${nextRunAt}::timestamptz)
      where id = ${item.message_attempt_id}::uuid
    `;
    return;
  }

  if (attemptNo === 3) {
    await sql`
      update public.message_attempts
      set
        campaign_id = ${item.campaign_id}::uuid,
        provider = coalesce(${providerName}, provider),
        provider_message_id = coalesce(${providerMessageId}, provider_message_id),
        follow_up_2_status = ${stepState},
        follow_up_2_sent_at = case
          when ${stepState} = 'sent' then coalesce(follow_up_2_sent_at, now())
          else follow_up_2_sent_at
        end
      where id = ${item.message_attempt_id}::uuid
    `;
  }
}

export async function resolveOrCreateCampaign(sql, { campaignId = null, campaignName = DEFAULT_EVERGREEN_NAME, source = 'webdash_run' } = {}) {
  let rows = [];

  if (campaignId) {
    rows = await sql`
      select id, name, status::text as status, settings, description, created_at, updated_at
      from public.campaigns
      where id = ${campaignId}::uuid
      limit 1
    `;
  }

  if (rows.length === 0) {
    rows = await sql`
      select id, name, status::text as status, settings, description, created_at, updated_at
      from public.campaigns
      where name = ${campaignName}
      order by created_at desc
      limit 1
    `;
  }

  if (rows.length > 0) return normalizeCampaignRow(rows[0]);

  const created = await sql`
    insert into public.campaigns (name, status, description, settings)
    values (
      ${campaignName || DEFAULT_EVERGREEN_NAME},
      'running'::public.campaign_status,
      'Kampania ciagla dla nowych leadow',
      ${sql.json(buildDefaultCampaignSettings(source))}::jsonb
    )
    returning id, name, status::text as status, settings, description, created_at, updated_at
  `;

  return normalizeCampaignRow(created[0]);
}

export async function syncCampaignLeads(sql, campaignId) {
  const rows = await sql`
    with src as (
      select distinct on (ma.lead_id)
        ma.lead_id,
        ma.lead_contact_id
      from public.message_attempts ma
      where ma.lead_id is not null
        and ma.lead_contact_id is not null
      order by ma.lead_id, ma.created_at desc, ma.id desc
    ), upserted as (
      insert into public.campaign_leads (
        campaign_id,
        lead_id,
        state,
        active_contact_id,
        contact_attempt_no,
        next_run_at,
        entered_at,
        updated_at
      )
      select
        ${campaignId}::uuid,
        s.lead_id,
        'in_campaign'::public.lead_status,
        s.lead_contact_id,
        1,
        now(),
        now(),
        now()
      from src s
      on conflict (campaign_id, lead_id) do update
      set
        active_contact_id = excluded.active_contact_id,
        state = case
          when campaign_leads.state = 'stopped' then campaign_leads.state
          else 'in_campaign'::public.lead_status
        end,
        updated_at = now()
      returning (xmax = 0) as inserted
    )
    select
      count(*)::int as total,
      count(*) filter (where inserted)::int as inserted,
      count(*) filter (where not inserted)::int as updated
    from upserted
  `;

  const tagged = await sql`
    update public.message_attempts ma
    set campaign_id = ${campaignId}::uuid
    where (ma.campaign_id is null or ma.campaign_id = ${campaignId}::uuid)
      and exists (
        select 1
        from public.campaign_leads cl
        where cl.campaign_id = ${campaignId}::uuid
          and cl.lead_id = ma.lead_id
          and cl.active_contact_id = ma.lead_contact_id
      )
      and ma.campaign_id is distinct from ${campaignId}::uuid
    returning id
  `;

  return {
    ...(rows[0] || { total: 0, inserted: 0, updated: 0 }),
    tagged_attempts: tagged.length,
  };
}

export async function stopRepliedCampaignLeads(sql, campaignId) {
  const rows = await sql`
    with replied as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
    )
    update public.campaign_leads cl
    set
      state = 'stopped'::public.lead_status,
      stop_reason = 'replied'::public.stop_reason,
      stopped_at = coalesce(cl.stopped_at, now()),
      next_run_at = null,
      updated_at = now()
    from replied r
    where cl.campaign_id = ${campaignId}::uuid
      and cl.lead_id = r.lead_id
      and cl.active_contact_id = r.lead_contact_id
      and (
        cl.state <> 'stopped'::public.lead_status
        or cl.stop_reason is distinct from 'replied'::public.stop_reason
        or cl.next_run_at is not null
      )
    returning cl.id
  `;

  return { stopped: rows.length };
}

export async function loadOutbox(sql, campaignId, limit = DEFAULT_SEND_LIMIT) {
  return sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.*
      from public.message_attempts ma
      where ma.campaign_id = ${campaignId}::uuid
         or ma.campaign_id is null
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    ), replied as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
    )
    select
      cl.id as campaign_lead_id,
      cl.campaign_id,
      cl.lead_id,
      cl.active_contact_id as lead_contact_id,
      cl.state::text as campaign_lead_state,
      cl.contact_attempt_no,
      cl.next_run_at,
      lc.email as to_email,
      la.id as message_attempt_id,
      la.provider,
      la.provider_message_id,
      la.sent_at,
      la.follow_up_1_subject,
      la.follow_up_1_text,
      la.follow_up_1_status,
      la.follow_up_1_scheduled_at,
      la.follow_up_1_sent_at,
      la.follow_up_2_subject,
      la.follow_up_2_text,
      la.follow_up_2_status,
      la.follow_up_2_scheduled_at,
      la.follow_up_2_sent_at,
      case
        when cl.contact_attempt_no = 1 then la.subject
        when cl.contact_attempt_no = 2 then coalesce(la.follow_up_1_subject, la.subject)
        when cl.contact_attempt_no = 3 then coalesce(la.follow_up_2_subject, la.subject)
        else la.subject
      end as send_subject,
      case
        when cl.contact_attempt_no = 1 then la.email
        when cl.contact_attempt_no = 2 then coalesce(la.follow_up_1_text, la.email)
        when cl.contact_attempt_no = 3 then coalesce(la.follow_up_2_text, la.email)
        else la.email
      end as send_body,
      la.subject as main_subject,
      la.email as main_body
    from public.campaign_leads cl
    join public.lead_contacts lc on lc.id = cl.active_contact_id
    join latest_attempt la on la.lead_id = cl.lead_id and la.lead_contact_id = cl.active_contact_id
    left join replied r
      on r.lead_id = cl.lead_id
     and r.lead_contact_id = cl.active_contact_id
    where cl.campaign_id = ${campaignId}::uuid
      and cl.state = 'in_campaign'
      and (cl.next_run_at is null or cl.next_run_at <= now())
      and cl.contact_attempt_no between 1 and 3
      and lc.email is not null
      and la.email is not null
      and r.lead_id is null
    order by cl.next_run_at nulls first, cl.updated_at asc
    limit ${Math.min(Math.max(Number(limit || DEFAULT_SEND_LIMIT), 1), 500)}
  `;
}

export async function markSent(sql, item, campaignSettings = {}, providerMessageId = null, providerName = null, executionMode = 'webdash_run') {
  const plan = getNextAttemptPlan(item, campaignSettings);
  const stepKey = getStepKey(Number(item?.contact_attempt_no || 1));

  await persistAttemptTelemetry(sql, item, {
    providerMessageId,
    providerName,
    stepState: 'sent',
    nextRunAt: plan.nextRunAt,
  });

  const eventMeta = {
    source: executionMode,
    to: item.to_email,
    attempt_no: item.contact_attempt_no,
    sequence_step: stepKey,
    provider_message_id: providerMessageId || null,
    provider: providerName || null,
  };

  await sql`
    insert into public.message_events (message_attempt_id, event_type, event_meta, created_at)
    values (
      ${item.message_attempt_id}::uuid,
      'sent'::public.message_event_type,
      ${sql.json(eventMeta)}::jsonb,
      now()
    )
  `;

  await sql`
    update public.campaign_leads cl
    set
      contact_attempt_no = ${plan.nextAttemptNo},
      next_run_at = ${plan.nextRunAt}::timestamptz,
      state = case
        when ${plan.stopAfterSend} then 'stopped'::public.lead_status
        else 'in_campaign'::public.lead_status
      end,
      stop_reason = case
        when ${plan.stopAfterSend} then 'other'::public.stop_reason
        else null
      end,
      stopped_at = case
        when ${plan.stopAfterSend} then coalesce(cl.stopped_at, now())
        else null
      end,
      updated_at = now()
    where cl.id = ${item.campaign_lead_id}::uuid
  `;

  return {
    step_key: stepKey,
    next_attempt_no: plan.nextAttemptNo,
    next_run_at: plan.nextRunAt,
    stopped: plan.stopAfterSend,
  };
}

export async function markFailed(sql, item, errMsg = 'send_failed', executionMode = 'webdash_run') {
  const attemptNo = Number(item?.contact_attempt_no || 1);
  const retryAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  if (attemptNo === 2 || attemptNo === 3) {
    await persistAttemptTelemetry(sql, item, {
      stepState: 'failed',
      nextRunAt: null,
    });
  }

  const eventMeta = {
    source: executionMode,
    to: item.to_email,
    attempt_no: item.contact_attempt_no,
    sequence_step: getStepKey(attemptNo),
    error: errMsg,
  };

  await sql`
    insert into public.message_events (message_attempt_id, event_type, event_meta, created_at)
    values (
      ${item.message_attempt_id}::uuid,
      'failed'::public.message_event_type,
      ${sql.json(eventMeta)}::jsonb,
      now()
    )
  `;

  await sql`
    update public.campaign_leads cl
    set
      next_run_at = ${retryAt}::timestamptz,
      updated_at = now()
    where cl.id = ${item.campaign_lead_id}::uuid
  `;

  return { retry_at: retryAt };
}

export async function runCampaignGuard(sql, {
  campaignId = null,
  campaignName = DEFAULT_EVERGREEN_NAME,
  dryRun = true,
  limit = DEFAULT_SEND_LIMIT,
  performSync = true,
  source = 'webdash_run',
  executionMode = 'webdash_run',
} = {}) {
  const campaign = await resolveOrCreateCampaign(sql, { campaignId, campaignName, source });
  const sync = performSync ? await syncCampaignLeads(sql, campaign.id) : null;
  const replied = await stopRepliedCampaignLeads(sql, campaign.id);
  const outbox = await loadOutbox(sql, campaign.id, limit);
  const outboxPreview = buildOutboxPreview(outbox);
  const campaignSettings = campaign?.settings || {};

  if (dryRun) {
    return {
      ok: true,
      mode: 'dry_run',
      campaign,
      sync,
      replied,
      queued: outbox.length,
      rows: outbox,
      outbox_preview: outboxPreview,
    };
  }

  const smtpWebhookUrl = process.env.N8N_SMTP_SEND_WEBHOOK_URL || 'https://n8n-production-c340.up.railway.app/webhook/smtp-send';
  const smtpToken = process.env.N8N_SMTP_SEND_TOKEN || 'SUPER_SECRET_TOKEN';

  if (!smtpWebhookUrl) {
    throw new Error('Missing N8N_SMTP_SEND_WEBHOOK_URL for live send');
  }

  let sent = 0;
  let failed = 0;
  const failures = [];

  for (const item of outbox) {
    try {
      const sendRes = await fetch(smtpWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: smtpToken,
          campaign_id: campaign.id,
          lead_id: item.lead_id,
          lead_contact_id: item.lead_contact_id,
          campaign_lead_id: item.campaign_lead_id,
          message_attempt_id: item.message_attempt_id,
          contact_attempt_no: item.contact_attempt_no,
          execution_mode: executionMode,
          sequence_step: getStepKey(Number(item.contact_attempt_no || 1)),
          to_email: item.to_email,
          subject: item.send_subject,
          body: item.send_body,
          campaign_lead_state: item.campaign_lead_state,
          next_run_at: item.next_run_at,
        }),
        cache: 'no-store',
      });

      const text = await sendRes.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!sendRes.ok || json?.ok === false) {
        throw new Error(json?.error || json?.message || `SMTP webhook HTTP ${sendRes.status}`);
      }

      const providerMessageId = json?.provider_message_id || json?.message_id || null;
      const providerName = json?.provider || json?.provider_name || null;
      const state = await markSent(sql, item, campaignSettings, providerMessageId, providerName, executionMode);
      sent += 1;

      failures.push({
        campaign_lead_id: item.campaign_lead_id,
        ok: true,
        step_key: state.step_key,
        next_run_at: state.next_run_at,
        stopped: state.stopped,
      });
    } catch (e) {
      const errMsg = String(e?.message || e);
      const retry = await markFailed(sql, item, errMsg, executionMode);
      failed += 1;
      failures.push({
        campaign_lead_id: item.campaign_lead_id,
        ok: false,
        error: errMsg,
        retry_at: retry.retry_at,
      });
    }
  }

  return {
    ok: true,
    mode: 'live',
    campaign,
    sync,
    replied,
    queued: outbox.length,
    outbox_preview: outboxPreview,
    sent,
    failed,
    results: failures,
  };
}

export function getCampaignRuntimeState(settings = {}) {
  const normalized = normalizeStoredCampaignSettings(settings);
  const config = getSequenceConfig(normalized);

  return {
    auto_sync_enabled: Boolean(normalized.auto_sync_enabled ?? true),
    auto_sync_status: normalized.auto_sync_status || 'running',
    auto_send_enabled: Boolean(normalized.auto_send_enabled ?? true),
    auto_send_status: normalized.auto_send_status || 'running',
    sync_interval_min: config.syncIntervalMin,
    last_sync_at: normalized.last_sync_at || null,
    last_auto_send_at: normalized.last_auto_send_at || normalized.last_scheduler_send_at || null,
    last_scheduler_result: normalized.last_scheduler_result || normalized.last_send_result || null,
    last_manual_send_at: normalized.last_manual_send_at || null,
    last_manual_send_result: normalized.last_manual_send_result || null,
    last_test_send_at: normalized.last_test_send_at || null,
    last_test_send_result: normalized.last_test_send_result || null,
  };
}

export async function getCampaignSendStats(sql, campaignId) {
  const [summary] = await sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.*
      from public.message_attempts ma
      where ma.campaign_id = ${campaignId}::uuid
         or ma.campaign_id is null
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    ), replied as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
    ), eligible as (
      select
        cl.id as campaign_lead_id,
        l.company_name,
        lc.email as to_email,
        cl.contact_attempt_no,
        cl.next_run_at,
        case when cl.next_run_at is null or cl.next_run_at <= now() then true else false end as due_now
      from public.campaign_leads cl
      join public.leads l on l.id = cl.lead_id
      join public.lead_contacts lc on lc.id = cl.active_contact_id
      join latest_attempt la on la.lead_id = cl.lead_id and la.lead_contact_id = cl.active_contact_id
      left join replied r
        on r.lead_id = cl.lead_id
       and r.lead_contact_id = cl.active_contact_id
      where cl.campaign_id = ${campaignId}::uuid
        and cl.state = 'in_campaign'
        and cl.contact_attempt_no between 1 and 3
        and lc.email is not null
        and la.email is not null
        and r.lead_id is null
    )
    select
      count(*)::int as eligible_total,
      count(*) filter (where due_now)::int as queued_now,
      min(next_run_at) filter (where next_run_at is not null)::timestamptz as next_due_at
    from eligible
  `;

  const nextDueRows = await sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.*
      from public.message_attempts ma
      where ma.campaign_id = ${campaignId}::uuid
         or ma.campaign_id is null
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    ), replied as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
    )
    select
      cl.id as campaign_lead_id,
      l.company_name,
      lc.email as to_email,
      cl.contact_attempt_no,
      cl.next_run_at
    from public.campaign_leads cl
    join public.leads l on l.id = cl.lead_id
    join public.lead_contacts lc on lc.id = cl.active_contact_id
    join latest_attempt la on la.lead_id = cl.lead_id and la.lead_contact_id = cl.active_contact_id
    left join replied r
      on r.lead_id = cl.lead_id
     and r.lead_contact_id = cl.active_contact_id
    where cl.campaign_id = ${campaignId}::uuid
      and cl.state = 'in_campaign'
      and cl.contact_attempt_no between 1 and 3
      and lc.email is not null
      and la.email is not null
      and r.lead_id is null
    order by case when cl.next_run_at is null or cl.next_run_at <= now() then 0 else 1 end, cl.next_run_at nulls first, cl.updated_at asc
    limit 1
  `;

  return {
    eligible_total: Number(summary?.eligible_total || 0),
    queued_now: Number(summary?.queued_now || 0),
    next_due_at: summary?.next_due_at || null,
    next_due_email: nextDueRows[0] || null,
  };
}

export function getNextExpectedRunAt(settings = {}, fallbackIntervalMin = DEFAULT_SYNC_INTERVAL_MIN) {
  const config = getSequenceConfig(settings);
  const intervalMin = toPositiveInt(fallbackIntervalMin, config.syncIntervalMin, { min: 1, max: 1440 });
  return new Date(Date.now() + intervalMin * 60 * 1000).toISOString();
}
