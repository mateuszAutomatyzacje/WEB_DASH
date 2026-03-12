import Link from 'next/link';
import AdminButton from '@/app/components/AdminButton.jsx';
import CampaignGuardTable from '@/app/components/CampaignGuardTable.jsx';
import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

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
      <AppShell title="Campaign not found" subtitle="Nie udało się znaleźć kampanii o tym ID.">
        <Card>
          <p><Link href="/campaigns">← Back to campaigns</Link></p>
        </Card>
      </AppShell>
    );
  }

  const leads = await sql`
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.id,
        ma.lead_id,
        ma.lead_contact_id
      from message_attempts ma
      where ma.campaign_id = ${id}
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

  const [attemptStats] = await sql`
    select
      count(*)::int as attempts_total,
      count(*) filter (where direction = 'outbound')::int as outbound_total,
      count(*) filter (where sent_at is not null)::int as main_sent_total,
      count(*) filter (where follow_up_1_sent_at is not null)::int as follow_up_1_sent_total,
      count(*) filter (where follow_up_2_sent_at is not null)::int as follow_up_2_sent_total
    from public.message_attempts
    where campaign_id = ${id}
  `;

  const [monitorStats] = await sql`
    with latest_event as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.lead_id,
        ma.lead_contact_id,
        me.event_type::text as event_type
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where ma.campaign_id = ${id}
      order by ma.lead_id, ma.lead_contact_id, me.created_at desc
    ), monitor as (
      select
        cl.id,
        case
          when cl.stop_reason::text = 'replied' or le.event_type = 'replied' then 'green'
          when coalesce(le.event_type, '') in ('bounced','complained','unsubscribed','failed') then 'red'
          when cl.contact_attempt_no >= 4 then 'red'
          else 'yellow'
        end as monitor_status
      from public.campaign_leads cl
      left join latest_event le
        on le.lead_id = cl.lead_id
       and le.lead_contact_id = cl.active_contact_id
      where cl.campaign_id = ${id}
    )
    select
      count(*)::int as total,
      count(*) filter (where monitor_status = 'green')::int as green,
      count(*) filter (where monitor_status = 'yellow')::int as yellow,
      count(*) filter (where monitor_status = 'red')::int as red
    from monitor
  `;

  return (
    <AppShell
      title={`Campaign: ${campaign.name}`}
      subtitle="Szczegóły kampanii, monitoring sekwencji, eventy wiadomości i lista leadów w jednym spójnym widoku."
      actions={<Link href="/campaigns" style={{ color: '#93c5fd' }}>← Back to campaigns</Link>}
    >
      <div style={{ marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Attempts total" value={attemptStats?.attempts_total ?? 0} />
        <StatCard label="Main sent" value={attemptStats?.main_sent_total ?? 0} />
        <StatCard label="FU1 sent" value={attemptStats?.follow_up_1_sent_total ?? 0} tone="warn" />
        <StatCard label="FU2 sent" value={attemptStats?.follow_up_2_sent_total ?? 0} tone="warn" />
        <StatCard label="Green" value={monitorStats?.green ?? 0} tone="success" helper="reply detected" />
        <StatCard label="Red" value={monitorStats?.red ?? 0} tone={(monitorStats?.red ?? 0) > 0 ? 'danger' : 'default'} helper="failure / no reply after FU2" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Campaign details</h2>
          <Table>
            <tbody>
              <tr><td style={td}>id</td><td style={td}>{campaign.id}</td></tr>
              <tr><td style={td}>status</td><td style={td}>{campaign.status}</td></tr>
              <tr><td style={td}>description</td><td style={td}>{campaign.description || '-'}</td></tr>
              <tr><td style={td}>updated_at</td><td style={td}>{String(campaign.updated_at)}</td></tr>
              <tr><td style={td}>created_at</td><td style={td}>{String(campaign.created_at)}</td></tr>
            </tbody>
          </Table>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Settings JSON</h2>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#020617', border: '1px solid #1f2937', borderRadius: 12, padding: 12, color: '#e2e8f0' }}>
            {JSON.stringify(campaign.settings || {}, null, 2)}
          </pre>
        </Card>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Monitoring summary</h2>
          <Table>
            <tbody>
              <tr><td style={td}>Message attempts total</td><td style={td}>{attemptStats?.attempts_total ?? 0}</td></tr>
              <tr><td style={td}>Main sent</td><td style={td}>{attemptStats?.main_sent_total ?? 0}</td></tr>
              <tr><td style={td}>Follow-up 1 sent</td><td style={td}>{attemptStats?.follow_up_1_sent_total ?? 0}</td></tr>
              <tr><td style={td}>Follow-up 2 sent</td><td style={td}>{attemptStats?.follow_up_2_sent_total ?? 0}</td></tr>
              <tr><td style={td}>GREEN</td><td style={{ ...td, color: '#86efac', fontWeight: 700 }}>{monitorStats?.green ?? 0}</td></tr>
              <tr><td style={td}>YELLOW</td><td style={{ ...td, color: '#fdba74', fontWeight: 700 }}>{monitorStats?.yellow ?? 0}</td></tr>
              <tr><td style={td}>RED</td><td style={{ ...td, color: '#fca5a5', fontWeight: 700 }}>{monitorStats?.red ?? 0}</td></tr>
            </tbody>
          </Table>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Message events in campaign</h2>
          <Table>
            <thead><tr><th style={th}>event_type</th><th style={th}>count</th></tr></thead>
            <tbody>
              {events.map((e) => <tr key={e.event_type}><td style={td}>{e.event_type}</td><td style={td}>{e.count}</td></tr>)}
              {events.length === 0 && <tr><td style={td} colSpan={2}>No message events</td></tr>}
            </tbody>
          </Table>
        </Card>
      </section>

      <Card>
        <h2 style={{ marginTop: 0 }}>Campaign leads</h2>
        <CampaignGuardTable rows={leads} />
      </Card>
    </AppShell>
  );
}
