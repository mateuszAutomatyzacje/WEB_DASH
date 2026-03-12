import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { getAnalyticsSnapshot } from '@/lib/reporting.js';

export const dynamic = 'force-dynamic';

export default async function WorkersPage() {
  const sql = getSql();
  const analytics = await getAnalyticsSnapshot(sql);

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
    <AppShell title="Operations" subtitle="Eventy wiadomości, obciążenie skrzynek, daily limits i logi błędów w jednym miejscu.">
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Total events" value={summary?.total_events ?? 0} />
        <StatCard label="Replies" value={summary?.replied ?? 0} tone="success" />
        <StatCard label="Problems" value={summary?.problems ?? 0} tone={(summary?.problems ?? 0) > 0 ? 'danger' : 'default'} helper="bounce / complaint / unsubscribe / failed" />
        <StatCard label="Last 24h" value={summary?.last_24h ?? 0} helper="ile eventów wpadło w ostatniej dobie" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>SMTP accounts / daily limits / warm-up</h2>
          <Table>
            <thead>
              <tr>
                <th style={th}>account</th>
                <th style={th}>status</th>
                <th style={th}>daily_limit</th>
                <th style={th}>sent_today</th>
                <th style={th}>failed_today</th>
                <th style={th}>remaining</th>
                <th style={th}>load</th>
                <th style={th}>last_used_at</th>
              </tr>
            </thead>
            <tbody>
              {analytics.smtpLoad.map((row) => (
                <tr key={row.id}>
                  <td style={td}>{row.account_key}<div style={{ fontSize: 12, color: '#94a3b8' }}>{row.from_email || '-'}</div></td>
                  <td style={td}>{row.status}</td>
                  <td style={td}>{row.daily_limit}</td>
                  <td style={td}>{row.sent_today}</td>
                  <td style={td}>{row.failed_today}</td>
                  <td style={td}>{row.remaining_today}</td>
                  <td style={{ ...td, color: Number(row.load_pct) >= 80 ? '#fca5a5' : '#cbd5e1' }}>{row.load_pct ?? 0}%</td>
                  <td style={td}>{row.last_used_at ? String(row.last_used_at) : '-'}</td>
                </tr>
              ))}
              {analytics.smtpLoad.length === 0 && <tr><td style={td} colSpan={8}>No SMTP accounts</td></tr>}
            </tbody>
          </Table>
        </Card>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.4fr', gap: 16, marginBottom: 20 }}>
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

      <Card>
        <h2 style={{ marginTop: 0 }}>Error logs</h2>
        <Table>
          <thead>
            <tr>
              <th style={th}>created_at</th>
              <th style={th}>campaign</th>
              <th style={th}>account</th>
              <th style={th}>to_email</th>
              <th style={th}>subject</th>
              <th style={th}>error</th>
            </tr>
          </thead>
          <tbody>
            {analytics.errorLogs.map((row, i) => (
              <tr key={`${row.created_at}-${i}`}>
                <td style={td}>{String(row.created_at)}</td>
                <td style={td}>{row.campaign_name}</td>
                <td style={td}>{row.account_key}</td>
                <td style={td}>{row.to_email}</td>
                <td style={td}>{row.subject}</td>
                <td style={{ ...td, color: '#fca5a5' }}>{row.error}</td>
              </tr>
            ))}
            {analytics.errorLogs.length === 0 && <tr><td style={td} colSpan={6}>No failed sends logged</td></tr>}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  );
}
