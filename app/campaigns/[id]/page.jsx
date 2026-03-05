import Link from 'next/link';
import AdminButton from '@/app/components/AdminButton.jsx';
import CampaignGuardTable from '@/app/components/CampaignGuardTable.jsx';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function CampaignDetailPage({ params }) {
  const { id } = params;

  const sql = getSql();
  const [campaign] = await sql`
    select id, name, status::text as status, description, settings, created_at, updated_at
    from campaigns
    where id = ${id}
    limit 1
  `;

  if (!campaign) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Campaign not found</h1>
        <p><Link href="/campaigns">← Back to campaigns</Link></p>
      </main>
    );
  }

  const leads = await sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.id,
        ma.lead_id,
        ma.lead_contact_id
      from message_attempts ma
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    ),
    latest_event as (
      select distinct on (me.message_attempt_id)
        me.message_attempt_id,
        me.event_type::text as latest_event_type,
        me.created_at as latest_event_at
      from message_events me
      order by me.message_attempt_id, me.created_at desc
    )
    select
      cl.id as campaign_lead_id,
      cl.state::text as state,
      cl.contact_attempt_no,
      cl.next_run_at,
      cl.stop_reason::text as stop_reason,
      cl.updated_at,
      l.id as lead_id,
      l.company_name,
      lc.id as lead_contact_id,
      lc.email,
      lc.first_name,
      lc.last_name,
      lc.title,
      le.latest_event_type,
      le.latest_event_at
    from campaign_leads cl
    join leads l on l.id = cl.lead_id
    left join lead_contacts lc on lc.id = cl.active_contact_id
    left join latest_attempt la
      on la.lead_id = cl.lead_id
     and la.lead_contact_id = cl.active_contact_id
    left join latest_event le
      on le.message_attempt_id = la.id
    where cl.campaign_id = ${id}
    order by cl.updated_at desc
    limit 300
  `;

  const events = await sql`
    select me.event_type::text as event_type, count(*)::int as count
    from message_attempts ma
    join message_events me on me.message_attempt_id = ma.id
    where ma.campaign_id = ${id}
    group by me.event_type
    order by count desc
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Campaign: {campaign.name}</h1>
      <p><Link href="/campaigns">← Back to campaigns</Link></p>

      <div style={{ marginBottom: 14 }}>
        <b>Actions:</b>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <AdminButton
            label="Set RUNNING"
            action="/api/admin/campaign/set-status"
            body={{ campaign_id: campaign.id, status: 'running' }}
            confirmText={`Ustawić kampanię "${campaign.name}" na RUNNING?`}
          />
          <AdminButton
            label="Pause"
            action="/api/admin/campaign/set-status"
            body={{ campaign_id: campaign.id, status: 'paused' }}
            confirmText={`Wstrzymać kampanię "${campaign.name}"?`}
          />
          <AdminButton
            label="Stop"
            action="/api/admin/campaign/set-status"
            body={{ campaign_id: campaign.id, status: 'stopped' }}
            confirmText={`Zatrzymać kampanię "${campaign.name}"?`}
          />
          <AdminButton
            label="Archive"
            action="/api/admin/campaign/set-status"
            body={{ campaign_id: campaign.id, status: 'archived' }}
            confirmText={`Zarchiwizować kampanię "${campaign.name}"?`}
          />
        </div>
      </div>

      <table style={{ borderCollapse: 'collapse', marginBottom: 20 }}>
        <tbody>
          <tr><td style={td}>id</td><td style={td}>{campaign.id}</td></tr>
          <tr><td style={td}>status</td><td style={td}>{campaign.status}</td></tr>
          <tr><td style={td}>description</td><td style={td}>{campaign.description || '-'}</td></tr>
          <tr><td style={td}>settings</td><td style={td}><pre style={{ margin: 0 }}>{JSON.stringify(campaign.settings || {}, null, 2)}</pre></td></tr>
          <tr><td style={td}>updated_at</td><td style={td}>{String(campaign.updated_at)}</td></tr>
        </tbody>
      </table>

      <h2>Message events in campaign</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 22 }}>
        <thead><tr><th style={th}>event_type</th><th style={th}>count</th></tr></thead>
        <tbody>
          {events.map((e) => <tr key={e.event_type}><td style={td}>{e.event_type}</td><td style={td}>{e.count}</td></tr>)}
          {events.length === 0 && <tr><td style={td} colSpan={2}>No message events</td></tr>}
        </tbody>
      </table>

      <h2>Campaign leads</h2>
      <CampaignGuardTable rows={leads} />
    </main>
  );
}
