import { getSql } from '@/lib/db.js';

const DEFAULT_CAMPAIGN_NAME = 'OUTSOURCING_IT_EVERGREEM';

async function ensureCampaign(sql, campaignId, campaignName) {
  let rows = [];

  if (campaignId) {
    rows = await sql`
      select id, name
      from public.campaigns
      where id = ${campaignId}::uuid
      limit 1
    `;
  }

  if (rows.length === 0) {
    rows = await sql`
      select id, name
      from public.campaigns
      where name = ${campaignName}
      order by created_at desc
      limit 1
    `;
  }

  if (rows.length > 0) return rows[0];

  const created = await sql`
    insert into campaigns (name, status, description, settings)
    values (
      ${campaignName || DEFAULT_CAMPAIGN_NAME},
      'running',
      'Kampania ciągła dla nowych leadów',
      ${JSON.stringify({ mode: 'evergreen', auto_enqueue: true, source: 'webdash_run' })}::jsonb
    )
    returning id, name
  `;

  return created[0];
}

async function syncCampaignLeads(sql, campaignId) {
  const [res] = await sql`
    with src as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      where ma.lead_id is not null
        and ma.lead_contact_id is not null
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
        state = case when campaign_leads.state = 'stopped' then campaign_leads.state else 'in_campaign'::public.lead_status end,
        updated_at = now()
      returning (xmax = 0) as inserted
    )
    select
      count(*)::int as total,
      count(*) filter (where inserted)::int as inserted,
      count(*) filter (where not inserted)::int as updated
    from upserted
  `;
  return res || { total: 0, inserted: 0, updated: 0 };
}

async function loadOutbox(sql, campaignId, limit) {
  return sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.*
      from public.message_attempts ma
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
      la.email as main_body,
      la.follow_up_1_subject,
      la.follow_up_1_text,
      la.follow_up_2_subject,
      la.follow_up_2_text
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
    limit ${limit}
  `;
}

async function markSent(sql, item, providerMessageId = null) {
  const eventMeta = JSON.stringify({
    source: 'webdash_run',
    to: item.to_email,
    attempt_no: item.contact_attempt_no,
    provider_message_id: providerMessageId || null,
  });

  await sql`
    insert into public.message_events (message_attempt_id, event_type, event_meta, created_at)
    values (
      ${item.message_attempt_id}::uuid,
      'sent'::public.message_event_type,
      ${eventMeta}::jsonb,
      now()
    )
  `;

  await sql`
    update public.campaign_leads cl
    set
      contact_attempt_no = cl.contact_attempt_no + 1,
      next_run_at = case when cl.contact_attempt_no + 1 <= 3 then now() + interval '2 days' else null end,
      state = case when cl.contact_attempt_no + 1 > 3 then 'stopped'::public.lead_status else cl.state end,
      stop_reason = case when cl.contact_attempt_no + 1 > 3 then 'other'::public.stop_reason else cl.stop_reason end,
      stopped_at = case when cl.contact_attempt_no + 1 > 3 then now() else cl.stopped_at end,
      updated_at = now()
    where cl.id = ${item.campaign_lead_id}::uuid
  `;
}

async function markFailed(sql, item, errMsg = 'send_failed') {
  const eventMeta = JSON.stringify({
    source: 'webdash_run',
    to: item.to_email,
    attempt_no: item.contact_attempt_no,
    error: errMsg,
  });

  await sql`
    insert into public.message_events (message_attempt_id, event_type, event_meta, created_at)
    values (
      ${item.message_attempt_id}::uuid,
      'failed'::public.message_event_type,
      ${eventMeta}::jsonb,
      now()
    )
  `;

  await sql`
    update public.campaign_leads cl
    set
      next_run_at = now() + interval '6 hours',
      updated_at = now()
    where cl.id = ${item.campaign_lead_id}::uuid
  `;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignName = String(body?.campaign_name || DEFAULT_CAMPAIGN_NAME).trim() || DEFAULT_CAMPAIGN_NAME;
    const dryRun = Boolean(body?.dry_run ?? true);
    const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 200);

    const sql = getSql();
    const campaign = await ensureCampaign(sql, body?.campaign_id || null, campaignName);
    const sync = await syncCampaignLeads(sql, campaign.id);
    const outbox = await loadOutbox(sql, campaign.id, limit);

    const outboxPreview = outbox.map((r) => ({
      campaign_lead_id: r.campaign_lead_id,
      message_attempt_id: r.message_attempt_id,
      to_email: r.to_email,
      send_subject: r.send_subject,
      send_body_preview: typeof r.send_body === 'string' ? r.send_body.slice(0, 120) : null,
      lead_id: r.lead_id,
      lead_contact_id: r.lead_contact_id,
      contact_attempt_no: r.contact_attempt_no,
    }));

    if (dryRun) {
      return Response.json({
        ok: true,
        mode: 'dry_run',
        campaign,
        sync,
        queued: outbox.length,
        rows: outbox,
        outbox_preview: outboxPreview,
      });
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
            execution_mode: 'webdash_run',
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
        try { json = JSON.parse(text); } catch { json = { raw: text }; }

        if (!sendRes.ok || json?.ok === false) {
          throw new Error(json?.error || json?.message || `SMTP webhook HTTP ${sendRes.status}`);
        }

        const providerMessageId = json?.provider_message_id || json?.message_id || null;
        await markSent(sql, item, providerMessageId);
        sent += 1;
      } catch (e) {
        const errMsg = String(e?.message || e);
        await markFailed(sql, item, errMsg);
        failed += 1;
        failures.push({ campaign_lead_id: item.campaign_lead_id, error: errMsg });
      }
    }

    return Response.json({
      ok: true,
      mode: 'live',
      campaign,
      sync,
      queued: outbox.length,
      outbox_preview: outboxPreview,
      sent,
      failed,
      failures,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
