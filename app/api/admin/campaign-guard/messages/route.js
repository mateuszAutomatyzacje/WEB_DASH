import { getSql } from '@/lib/db.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignIdRaw = searchParams.get('campaign_id') || null;
    const campaignId = campaignIdRaw && /^[0-9a-fA-F-]{36}$/.test(campaignIdRaw) ? campaignIdRaw : null;
    const campaignName = searchParams.get('campaign_name') || null;
    const state = searchParams.get('state') || null;
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);

    if (!campaignId && !campaignName) {
      throw new Error('Provide campaign_id or campaign_name');
    }

    const sql = getSql();

    const rows = await sql`
      with c as (
        select id, name
        from public.campaigns
        where (${campaignId}::uuid is not null and id = ${campaignId}::uuid)
           or (${campaignName}::text is not null and name = ${campaignName}::text)
        order by created_at desc
        limit 1
      ),
      latest_attempt as (
        select distinct on (ma.lead_id, ma.lead_contact_id)
          ma.id,
          ma.lead_id,
          ma.lead_contact_id,
          ma.subject,
          ma.sent_at,
          ma.created_at
        from public.message_attempts ma
        order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
      ),
      latest_event as (
        select distinct on (me.message_attempt_id)
          me.message_attempt_id,
          me.event_type::text as event_type,
          me.created_at
        from public.message_events me
        order by me.message_attempt_id, me.created_at desc
      )
      select
        cl.id as campaign_lead_id,
        cl.campaign_id,
        c.name as campaign_name,
        cl.state::text as state,
        cl.contact_attempt_no,
        cl.next_run_at,
        cl.stop_reason::text as stop_reason,
        l.id as lead_id,
        l.company_name,
        lc.id as lead_contact_id,
        lc.first_name,
        lc.last_name,
        lc.email,
        la.id as message_attempt_id,
        la.subject,
        la.sent_at,
        le.event_type as latest_event_type,
        le.created_at as latest_event_at,
        cl.updated_at
      from public.campaign_leads cl
      join c on c.id = cl.campaign_id
      join public.leads l on l.id = cl.lead_id
      left join public.lead_contacts lc on lc.id = cl.active_contact_id
      left join latest_attempt la
        on la.lead_id = cl.lead_id
       and la.lead_contact_id = cl.active_contact_id
      left join latest_event le
        on le.message_attempt_id = la.id
      where (${state}::text is null or cl.state::text = ${state}::text)
      order by cl.updated_at desc
      limit ${limit}
    `;

    return Response.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
