import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { getAnalyticsSnapshot } from '@/lib/reporting.js';
import { formatDateTime } from '@/lib/time.js';

function renderContact(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.target_email || row.email || '-';
}

function renderSchedulerResult(row) {
  if (!row) return '-';
  const sent = Number(row.last_scheduler_sent || 0);
  const failed = Number(row.last_scheduler_failed || 0);
  const queued = Number(row.last_scheduler_queued || 0);
  return `sent=${sent}, failed=${failed}, queued=${queued}`;
}

export default async function ApplicationLogsScreen({
  title = 'Logs',
  subtitle = 'Pelny timeline logow aplikacji: delivery, scraper i checkpointy evergreen.',
} = {}) {
  const sql = getSql();
  const analytics = await getAnalyticsSnapshot(sql);

  const [summary] = await sql`
    select
      count(*)::int as total_events,
      count(*) filter (where event_type = 'sent')::int as sent,
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

  const deliveryLogs = await sql`
    select
      me.created_at,
      me.event_type::text as event_type,
      coalesce(me.event_meta->>'source', '-') as source,
      coalesce(me.event_meta->>'sequence_step', '-') as sequence_step,
      coalesce(me.event_meta->>'to', ma.to_email::text, lc.email::text, '-') as target_email,
      coalesce(me.event_meta->>'provider', ma.provider, '-') as provider,
      coalesce(me.event_meta->>'provider_message_id', ma.provider_message_id, '-') as provider_message_id,
      coalesce(me.event_meta->>'error', '-') as error,
      c.name as campaign_name,
      l.company_name,
      lc.first_name,
      lc.last_name,
      case
        when coalesce(me.event_meta->>'attempt_no', '1') = '2' then coalesce(ma.follow_up_1_subject, ma.subject)
        when coalesce(me.event_meta->>'attempt_no', '1') = '3' then coalesce(ma.follow_up_2_subject, ma.subject)
        else ma.subject
      end as subject
    from public.message_events me
    join public.message_attempts ma on ma.id = me.message_attempt_id
    left join public.campaigns c on c.id = ma.campaign_id
    left join public.leads l on l.id = ma.lead_id
    left join public.lead_contacts lc on lc.id = ma.lead_contact_id
    order by me.created_at desc
    limit 200
  `;

  const [scrapeState] = await sql`
    select
      running,
      last_run_status,
      last_run_at,
      last_run_id,
      locked_until,
      updated_at,
      base_url,
      crawl4ai_endpoint
    from public.scrape_settings
    where id = 'global'
    limit 1
  `;

  const runtimeRows = await sql`
    select
      id,
      name,
      status::text as status,
      settings->>'last_sync_at' as last_sync_at,
      settings->>'next_expected_sync_at' as next_expected_sync_at,
      settings->>'last_auto_send_at' as last_auto_send_at,
      settings->>'next_expected_send_at' as next_expected_send_at,
      settings->>'last_test_send_at' as last_test_send_at,
      settings->'last_scheduler_result'->>'sent' as last_scheduler_sent,
      settings->'last_scheduler_result'->>'failed' as last_scheduler_failed,
      settings->'last_scheduler_result'->>'queued' as last_scheduler_queued,
      settings->'last_scheduler_result'->>'timestamp' as last_scheduler_at,
      settings->>'send_interval_min' as send_interval_min,
      settings->>'lead_sync_interval_min' as lead_sync_interval_min,
      settings->>'send_email_interval_min' as send_email_interval_min
    from public.campaigns
    where coalesce(settings->>'mode', '') = 'evergreen'
    order by updated_at desc
    limit 20
  `;

  return (
    <AppShell title={title} subtitle={subtitle}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Total events" value={summary?.total_events ?? 0} />
        <StatCard label="Sent" value={summary?.sent ?? 0} tone="success" />
        <StatCard label="Replies" value={summary?.replied ?? 0} tone="success" />
        <StatCard label="Problems" value={summary?.problems ?? 0} tone={(summary?.problems ?? 0) > 0 ? 'danger' : 'default'} helper="bounce / complaint / unsubscribe / failed" />
        <StatCard label="Last 24h" value={summary?.last_24h ?? 0} helper="ile eventow wpadlo w ostatniej dobie" />
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
                  <td style={td}>{formatDateTime(row.last_used_at)}</td>
                </tr>
              ))}
              {analytics.smtpLoad.length === 0 ? <tr><td style={td} colSpan={8}>No SMTP accounts</td></tr> : null}
            </tbody>
          </Table>
        </Card>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: 16, marginBottom: 20 }}>
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
              {events.map((row) => (
                <tr key={row.event_type}>
                  <td style={td}>{row.event_type}</td>
                  <td style={td}>{row.total}</td>
                  <td style={td}>{formatDateTime(row.latest_at)}</td>
                </tr>
              ))}
              {events.length === 0 ? <tr><td style={td} colSpan={3}>No events</td></tr> : null}
            </tbody>
          </Table>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Scraper runtime</h2>
          <Table>
            <tbody>
              <tr><td style={td}>running</td><td style={td}>{scrapeState ? String(scrapeState.running) : '-'}</td></tr>
              <tr><td style={td}>last_run_status</td><td style={td}>{scrapeState?.last_run_status || '-'}</td></tr>
              <tr><td style={td}>last_run_at</td><td style={td}>{formatDateTime(scrapeState?.last_run_at)}</td></tr>
              <tr><td style={td}>last_run_id</td><td style={td}>{scrapeState?.last_run_id || '-'}</td></tr>
              <tr><td style={td}>locked_until</td><td style={td}>{formatDateTime(scrapeState?.locked_until)}</td></tr>
              <tr><td style={td}>updated_at</td><td style={td}>{formatDateTime(scrapeState?.updated_at)}</td></tr>
              <tr><td style={td}>base_url</td><td style={td}>{scrapeState?.base_url || '-'}</td></tr>
              <tr><td style={td}>crawl4ai_endpoint</td><td style={td}>{scrapeState?.crawl4ai_endpoint || '-'}</td></tr>
            </tbody>
          </Table>
        </Card>
      </section>

      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Delivery logs</h2>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
          Pelny timeline eventow z <code>message_events</code>: kiedy, z jakiego zrodla, do kogo, z jakim krokiem sekwencji i jaki byl wynik.
        </div>
        <Table>
          <thead>
            <tr>
              <th style={th}>created_at</th>
              <th style={th}>source</th>
              <th style={th}>event</th>
              <th style={th}>campaign</th>
              <th style={th}>company</th>
              <th style={th}>contact / target</th>
              <th style={th}>step</th>
              <th style={th}>subject / error</th>
            </tr>
          </thead>
          <tbody>
            {deliveryLogs.map((row, index) => (
              <tr key={`${row.created_at}-${row.provider_message_id}-${index}`}>
                <td style={td}>{formatDateTime(row.created_at)}</td>
                <td style={td}>
                  {row.source}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{row.provider || '-'}</div>
                </td>
                <td style={{ ...td, fontWeight: 700, color: row.event_type === 'failed' ? '#fca5a5' : row.event_type === 'sent' ? '#86efac' : '#f8fafc' }}>{row.event_type}</td>
                <td style={td}>{row.campaign_name || '-'}</td>
                <td style={td}>{row.company_name || '-'}</td>
                <td style={td}>
                  {renderContact(row)}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{row.target_email || '-'}</div>
                </td>
                <td style={td}>
                  {row.sequence_step || '-'}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{row.provider_message_id || '-'}</div>
                </td>
                <td style={td}>
                  <div>{row.subject || '-'}</div>
                  <div style={{ fontSize: 12, color: row.error && row.error !== '-' ? '#fca5a5' : '#94a3b8', marginTop: 4 }}>{row.error || '-'}</div>
                </td>
              </tr>
            ))}
            {deliveryLogs.length === 0 ? <tr><td style={td} colSpan={8}>No delivery logs yet</td></tr> : null}
          </tbody>
        </Table>
      </Card>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Evergreen runtime checkpoints</h2>
          <Table>
            <thead>
              <tr>
                <th style={th}>campaign</th>
                <th style={th}>status</th>
                <th style={th}>intervals</th>
                <th style={th}>last sync</th>
                <th style={th}>last auto-send</th>
                <th style={th}>next expected</th>
                <th style={th}>last scheduler result</th>
              </tr>
            </thead>
            <tbody>
              {runtimeRows.map((row) => (
                <tr key={row.id}>
                  <td style={td}>
                    {row.name}
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>last test: {formatDateTime(row.last_test_send_at)}</div>
                  </td>
                  <td style={td}>{row.status}</td>
                  <td style={td}>
                    scraper {row.send_interval_min || '-'}m
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>sync {row.lead_sync_interval_min || '-'}m | send {row.send_email_interval_min || '-'}m</div>
                  </td>
                  <td style={td}>
                    {formatDateTime(row.last_sync_at)}
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>next: {formatDateTime(row.next_expected_sync_at)}</div>
                  </td>
                  <td style={td}>{formatDateTime(row.last_auto_send_at)}</td>
                  <td style={td}>{formatDateTime(row.next_expected_send_at)}</td>
                  <td style={td}>
                    {renderSchedulerResult(row)}
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{formatDateTime(row.last_scheduler_at)}</div>
                  </td>
                </tr>
              ))}
              {runtimeRows.length === 0 ? <tr><td style={td} colSpan={7}>No evergreen campaigns</td></tr> : null}
            </tbody>
          </Table>
        </Card>
      </section>

      <Card style={{ marginTop: 20 }}>
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
            {analytics.errorLogs.map((row, index) => (
              <tr key={`${row.created_at}-${index}`}>
                <td style={td}>{formatDateTime(row.created_at)}</td>
                <td style={td}>{row.campaign_name}</td>
                <td style={td}>{row.account_key}</td>
                <td style={td}>{row.to_email}</td>
                <td style={td}>{row.subject}</td>
                <td style={{ ...td, color: '#fca5a5' }}>{row.error}</td>
              </tr>
            ))}
            {analytics.errorLogs.length === 0 ? <tr><td style={td} colSpan={6}>No failed sends logged</td></tr> : null}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  );
}
