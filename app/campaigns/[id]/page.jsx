import Link from 'next/link';
import AdminButton from '@/app/components/AdminButton.jsx';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function CampaignDetailPage({ params }) {
  const { id } = params;

  const sql = getSql();
  const [campaign] = await sql`
    select id, name, status::text as status, description, created_at, updated_at
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
    select
      cl.id,
      cl.state::text as state,
      cl.current_step_no,
      cl.next_run_at,
      cl.stop_reason::text as stop_reason,
      cl.updated_at,
      l.id as lead_id,
      l.email,
      l.company_name,
      l.person_full_name
    from campaign_leads cl
    join leads l on l.id = cl.lead_id
    where cl.campaign_id = ${id}
    order by cl.updated_at desc
    limit 200
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
        <span style={{ marginLeft: 10, fontSize: 12, color: '#555' }}>
          (requires ADMIN_TOKEN)
        </span>
        <div style={{ marginTop: 8 }}>
          <AdminButton
            label="Start campaign"
            action="/api/admin/campaign/start"
            body={{ campaign_id: campaign.id }}
            confirmText={`Startować kampanię \"${campaign.name}\"? (status→running)`}
          />
        </div>
      </div>

      <table style={{ borderCollapse: 'collapse', marginBottom: 20 }}>
        <tbody>
          <tr><td style={td}>id</td><td style={td}>{campaign.id}</td></tr>
          <tr><td style={td}>status</td><td style={td}>{campaign.status}</td></tr>
          <tr><td style={td}>description</td><td style={td}>{campaign.description || '-'}</td></tr>
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
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>lead</th>
            <th style={th}>email</th>
            <th style={th}>company</th>
            <th style={th}>state</th>
            <th style={th}>step</th>
            <th style={th}>next_run_at</th>
            <th style={th}>stop_reason</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.person_full_name || r.lead_id}</td>
              <td style={td}>{r.email || '-'}</td>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{r.state}</td>
              <td style={td}>{r.current_step_no ?? '-'}</td>
              <td style={td}>{r.next_run_at ? String(r.next_run_at) : '-'}</td>
              <td style={td}>{r.stop_reason || '-'}</td>
            </tr>
          ))}
          {leads.length === 0 && <tr><td style={td} colSpan={7}>No leads in campaign</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
