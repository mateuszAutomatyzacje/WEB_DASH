import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

export default async function WorkersPage() {
  const sql = getSql();

  const [summary] = await sql`
    select
      count(*)::int as total_events,
      count(*) filter (where event_type = 'replied')::int as replied,
      count(*) filter (where event_type in ('bounced','complained','unsubscribed','failed'))::int as problems,
      count(*) filter (where created_at >= now() - interval '24 hours')::int as last_24h
    from public.message_events
  `;

  const events = await sql`
    select
      me.event_type::text as event_type,
      count(*)::int as total,
      max(me.created_at) as latest_at
    from public.message_events me
    group by me.event_type
    order by total desc
  `;

  const recent = await sql`
    select
      me.created_at,
      me.event_type::text as event_type,
      l.company_name,
      lc.email,
      c.name as campaign_name
    from public.message_events me
    join public.message_attempts ma on ma.id = me.message_attempt_id
    join public.leads l on l.id = ma.lead_id
    left join public.lead_contacts lc on lc.id = ma.lead_contact_id
    left join public.campaigns c on c.id = ma.campaign_id
    order by me.created_at desc
    limit 200
  `;

  return (
    <AppShell title="Operations" subtitle="Jedno miejsce do sprawdzenia, co system robił ostatnio: eventy wiadomości, reply, błędy i świeże zdarzenia operacyjne.">
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Total events" value={summary?.total_events ?? 0} />
        <StatCard label="Replies" value={summary?.replied ?? 0} tone="success" />
        <StatCard label="Problems" value={summary?.problems ?? 0} tone={(summary?.problems ?? 0) > 0 ? 'danger' : 'default'} helper="bounce / complaint / unsubscribe / failed" />
        <StatCard label="Last 24h" value={summary?.last_24h ?? 0} helper="ile eventów wpadło w ostatniej dobie" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.4fr', gap: 16 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Event summary</h2>
          <Table>
            <thead>
              <tr>
                <th style={th}>event_type</th>
                <th style={th}>count</th>
                <th style={th}>latest_at</th>
              </tr>
            </thead>
            <tbody>
              {events.map((r) => (
                <tr key={r.event_type}>
                  <td style={td}>{r.event_type}</td>
                  <td style={td}>{r.total}</td>
                  <td style={td}>{r.latest_at ? String(r.latest_at) : '-'}</td>
                </tr>
              ))}
              {events.length === 0 && <tr><td style={td} colSpan={3}>No events</td></tr>}
            </tbody>
          </Table>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Recent events</h2>
          <Table>
            <thead>
              <tr>
                <th style={th}>created_at</th>
                <th style={th}>event</th>
                <th style={th}>campaign</th>
                <th style={th}>company</th>
                <th style={th}>email</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={`${r.created_at}-${i}`}>
                  <td style={td}>{String(r.created_at)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.event_type}</td>
                  <td style={td}>{r.campaign_name || '-'}</td>
                  <td style={td}>{r.company_name || '-'}</td>
                  <td style={td}>{r.email || '-'}</td>
                </tr>
              ))}
              {recent.length === 0 && <tr><td style={td} colSpan={5}>No recent events</td></tr>}
            </tbody>
          </Table>
        </Card>
      </section>
    </AppShell>
  );
}
