import Link from 'next/link';
import { getSql } from '@/lib/db.js';
import CampaignConfigPanel from '@/app/components/CampaignConfigPanel.jsx';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function CampaignsPage() {
  const sql = getSql();
  const rows = await sql`
    with latest_event as (
      select distinct on (ma.campaign_id, ma.lead_id, ma.lead_contact_id)
        ma.campaign_id,
        ma.lead_id,
        ma.lead_contact_id,
        me.event_type::text as event_type
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where ma.campaign_id is not null
      order by ma.campaign_id, ma.lead_id, ma.lead_contact_id, me.created_at desc
    ), monitor as (
      select
        cl.campaign_id,
        cl.id as campaign_lead_id,
        case
          when cl.stop_reason::text = 'replied' or le.event_type = 'replied' then 'green'
          when coalesce(le.event_type, '') in ('bounced','complained','unsubscribed','failed') then 'red'
          when cl.contact_attempt_no >= 4 then 'red'
          else 'yellow'
        end as monitor_status
      from public.campaign_leads cl
      left join latest_event le
        on le.campaign_id = cl.campaign_id
       and le.lead_id = cl.lead_id
       and le.lead_contact_id = cl.active_contact_id
    )
    select
      c.id,
      c.name,
      c.status::text as status,
      c.created_at,
      count(cl.id)::int as leads_total,
      count(cl.id) filter (where cl.state = 'in_campaign')::int as active_in_queue,
      count(cl.id) filter (where cl.stop_reason = 'replied')::int as replied,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'green')::int as green,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'yellow')::int as yellow,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'red')::int as red
    from public.campaigns c
    left join public.campaign_leads cl on cl.campaign_id = c.id
    left join monitor m on m.campaign_lead_id = cl.id
    group by c.id
    order by c.created_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Campaigns</h1>
      <p><Link href="/">← Overview</Link></p>
      <CampaignConfigPanel />

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>name</th>
            <th style={th}>status</th>
            <th style={th}>leads_total</th>
            <th style={th}>active_in_queue</th>
            <th style={th}>replied</th>
            <th style={th}>green</th>
            <th style={th}>yellow</th>
            <th style={th}>red</th>
            <th style={th}>created_at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}><Link href={`/campaigns/${r.id}`}>{r.name}</Link></td>
              <td style={td}>{r.status}</td>
              <td style={td}>{r.leads_total}</td>
              <td style={td}>{r.active_in_queue}</td>
              <td style={td}>{r.replied}</td>
              <td style={td}><b style={{ color: '#0a7d22' }}>{r.green}</b></td>
              <td style={td}><b style={{ color: '#8a6d00' }}>{r.yellow}</b></td>
              <td style={td}><b style={{ color: '#b00020' }}>{r.red}</b></td>
              <td style={td}>{String(r.created_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={9}>No campaigns</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
