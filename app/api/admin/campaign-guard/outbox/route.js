import { getSql } from '@/lib/db.js';

const DEFAULT_CAMPAIGN_NAME = 'OUTSOURCING_IT_EVERGREEM';

async function resolveCampaign(sql, campaignId, campaignName) {
  let rows = [];

  if (campaignId) {
    rows = await sql`
      select id, name, status::text as status
      from public.campaigns
      where id = ${campaignId}::uuid
      limit 1
    `;
  }

  if (rows.length === 0) {
    rows = await sql`
      select id, name, status::text as status
      from public.campaigns
      where name = ${campaignName}
      order by created_at desc
      limit 1
    `;
  }

  return rows[0] || null;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaign_id');
    const campaignName = searchParams.get('campaign_name') || DEFAULT_CAMPAIGN_NAME;
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 500);

    const sql = getSql();
    const campaign = await resolveCampaign(sql, campaignId, campaignName);
    if (!campaign) throw new Error('campaign not found');

    const rows = await sql`
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
        c.name as campaign_name,
        cl.lead_id,
        cl.active_contact_id as lead_contact_id,
        cl.contact_attempt_no,
        cl.next_run_at,
        l.company_name,
        lc.email as to_email,
        lc.first_name,
        lc.last_name,
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
        end as send_body
      from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      join public.leads l on l.id = cl.lead_id
      join public.lead_contacts lc on lc.id = cl.active_contact_id
      join latest_attempt la
        on la.lead_id = cl.lead_id
       and la.lead_contact_id = cl.active_contact_id
      left join replied r
        on r.lead_id = cl.lead_id
       and r.lead_contact_id = cl.active_contact_id
      where cl.campaign_id = ${campaign.id}::uuid
        and cl.state = 'in_campaign'
        and (cl.next_run_at is null or cl.next_run_at <= now())
        and cl.contact_attempt_no between 1 and 3
        and lc.email is not null
        and la.email is not null
        and r.lead_id is null
      order by cl.next_run_at nulls first, cl.updated_at asc
      limit ${limit}
    `;

    return Response.json({ ok: true, campaign, count: rows.length, rows });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
