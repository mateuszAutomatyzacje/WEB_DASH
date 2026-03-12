import Link from 'next/link';
import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import LineChartCard from '@/app/components/LineChartCard.jsx';
import { getSql } from '@/lib/db.js';
import { getAnalyticsSnapshot } from '@/lib/reporting.js';

export const dynamic = 'force-dynamic';

async function getDashboardData() {
  const sql = getSql();
  const analytics = await getAnalyticsSnapshot(sql);

  const [totals] = await sql`
    with latest_event_per_contact as (
      select distinct on (ma.campaign_id, ma.lead_id, ma.lead_contact_id)
        ma.campaign_id,
        ma.lead_id,
        ma.lead_contact_id,
        me.event_type::text as event_type,
        me.created_at
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where ma.campaign_id is not null
      order by ma.campaign_id, ma.lead_id, ma.lead_contact_id, me.created_at desc
    )
    select
      (select count(*)::int from public.leads) as leads_total,
      (select count(*)::int from public.campaigns) as campaigns_total,
      (select count(*)::int from public.campaigns where status = 'running') as campaigns_running,
      (select count(*)::int from public.campaign_leads where state in ('new','enriched','in_campaign')) as campaign_active_total,
      (select count(*)::int from public.campaign_leads where next_run_at <= now()) as queue_overdue,
      (select count(*)::int from public.message_events where event_type = 'replied') as replies_total,
      (select count(*)::int from public.message_events where event_type in ('bounced','complained','unsubscribed','failed')) as negative_events_total,
      (select count(*)::int from public.message_events where created_at >= now() - interval '7 days' and event_type = 'replied') as replies_last_7d,
      (select count(*)::int from public.leads where created_at >= now() - interval '7 days') as new_leads_last_7d,
      (
        select count(*)::int
        from public.lead_contacts lc
        where lc.status in ('enriched', 'in_campaign', 'closed')
      ) as progressed_contacts_total,
      (
        select count(*)::int
        from latest_event_per_contact le
        where le.event_type = 'replied'
      ) as warm_leads_open_total
  `;

  const campaigns = await sql`
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
      count(cl.id)::int as leads_total,
      count(cl.id) filter (where cl.state in ('new','enriched','in_campaign'))::int as active_total,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'green')::int as green,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'yellow')::int as yellow,
      count(m.campaign_lead_id) filter (where m.monitor_status = 'red')::int as red
    from public.campaigns c
    left join public.campaign_leads cl on cl.campaign_id = c.id
    left join monitor m on m.campaign_lead_id = cl.id
    group by c.id
    order by red desc, yellow desc, c.created_at desc
    limit 8
  `;

  const warmLeads = await sql`
    with replied as (
      select
        ma.lead_id,
        ma.lead_contact_id,
        ma.campaign_id,
        max(me.created_at) as replied_at
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
      group by ma.lead_id, ma.lead_contact_id, ma.campaign_id
    )
    select
      r.replied_at,
      l.company_name,
      c.id as campaign_id,
      c.name as campaign_name,
      lc.first_name,
      lc.last_name,
      lc.email
    from replied r
    join public.leads l on l.id = r.lead_id
    left join public.campaigns c on c.id = r.campaign_id
    left join public.lead_contacts lc on lc.id = r.lead_contact_id
    order by r.replied_at desc
    limit 8
  `;

  const queue = await sql`
    select
      cl.id,
      cl.next_run_at,
      cl.contact_attempt_no,
      c.id as campaign_id,
      c.name as campaign_name,
      l.company_name,
      lc.email
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    join public.leads l on l.id = cl.lead_id
    left join public.lead_contacts lc on lc.id = cl.active_contact_id
    where cl.next_run_at is not null
      and cl.state in ('in_campaign','new','enriched')
    order by cl.next_run_at asc
    limit 8
  `;

  return { totals: totals || {}, campaigns, warmLeads, queue, analytics };
}

export default async function Page() {
  try {
    const { totals, campaigns, warmLeads, queue, analytics } = await getDashboardData();

    return (
      <AppShell
        title="Dashboard"
        subtitle="Jeden wspólny panel operacyjno-kliencki: wyniki kampanii, warm leads, wydajność skrzynek i priorytety do ogarnięcia."
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><a href="/api/report/xls" style={{ color: '#93c5fd' }}>Export XLS</a><a href="/api/report/pdf" style={{ color: '#93c5fd' }}>Export PDF</a></div>}
      >
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label="Leads total" value={totals.leads_total} helper={`+${totals.new_leads_last_7d ?? 0} w ostatnich 7 dniach`} />
          <StatCard label="Campaigns running" value={totals.campaigns_running} helper={`z ${totals.campaigns_total ?? 0} wszystkich`} tone="success" />
          <StatCard label="Open Rate" value={`${analytics.totals.open_rate}%`} helper={`opened: ${analytics.totals.opened}`} />
          <StatCard label="CTR" value={`${analytics.totals.ctr}%`} helper={`clicked: ${analytics.totals.clicked}`} />
          <StatCard label="Reply Rate" value={`${analytics.totals.reply_rate}%`} helper={`reply events: ${analytics.totals.replied}`} tone="success" />
          <StatCard label="Bounce Rate" value={`${analytics.totals.bounce_rate}%`} helper={`bounced: ${analytics.totals.bounced}`} tone={analytics.totals.bounce_rate > 5 ? 'danger' : 'warn'} />
          <StatCard label="Queue overdue" value={totals.queue_overdue} helper="rekordy z next_run_at <= teraz" tone={Number(totals.queue_overdue) > 0 ? 'danger' : 'default'} />
          <StatCard label="Warm leads" value={totals.warm_leads_open_total} helper={`reply events total: ${totals.replies_total ?? 0}`} tone="success" />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.85fr', gap: 16, marginBottom: 20 }}>
          <LineChartCard title="Sent vs Replies" subtitle="Ostatnie 14 dni" series={analytics.dailySeries} />
          <Card>
            <h2 style={{ marginTop: 0, fontSize: 20 }}>SMTP load / warm-up</h2>
            <Table>
              <thead>
                <tr><th style={th}>Inbox</th><th style={th}>Status</th><th style={th}>Today</th><th style={th}>Load</th></tr>
              </thead>
              <tbody>
                {analytics.smtpLoad.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.account_key}<div style={{ fontSize: 12, color: '#94a3b8' }}>{row.from_email || '-'}</div></td>
                    <td style={td}>{row.status}</td>
                    <td style={td}>{row.sent_today}/{row.daily_limit}</td>
                    <td style={{ ...td, color: Number(row.load_pct) > 80 ? '#fca5a5' : '#cbd5e1' }}>{row.load_pct ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 20 }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Campaign health</h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Najpierw te kampanie, gdzie rośnie czerwony lub żółty status.</div>
              </div>
              <Link href="/campaigns">Zobacz wszystkie →</Link>
            </div>
            <Table>
              <thead>
                <tr>
                  <th style={th}>Campaign</th>
                  <th style={th}>Status</th>
                  <th style={th}>Active</th>
                  <th style={th}>Green</th>
                  <th style={th}>Yellow</th>
                  <th style={th}>Red</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><Link href={`/campaigns/${r.id}`}>{r.name}</Link></td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>{r.active_total}</td>
                    <td style={{ ...td, color: '#86efac', fontWeight: 700 }}>{r.green}</td>
                    <td style={{ ...td, color: '#fdba74', fontWeight: 700 }}>{r.yellow}</td>
                    <td style={{ ...td, color: '#fca5a5', fontWeight: 700 }}>{r.red}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <h2 style={{ marginTop: 0, fontSize: 20 }}>What needs attention</h2>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li><b>{totals.queue_overdue ?? 0}</b> rekordów czeka już po planowanym <code>next_run_at</code>.</li>
              <li><b>{analytics.errorLogs.length}</b> ostatnich błędów wysyłki jest dostępnych w operations/report.</li>
              <li><b>{analytics.smtpLoad.filter((r) => Number(r.load_pct) >= 80).length}</b> skrzynek jest obciążonych na 80%+ daily limitu.</li>
              <li><b>{totals.warm_leads_open_total ?? 0}</b> warm leadów warto przekuć w realny pipeline handoffu.</li>
            </ul>
          </Card>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Latest warm leads</h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Ostatnie odpowiedzi — tu zwykle zaczyna się najważniejsza praca handlowca.</div>
              </div>
              <Link href="/warm-leads">Pełny pipeline →</Link>
            </div>
            <Table>
              <thead>
                <tr>
                  <th style={th}>Replied at</th>
                  <th style={th}>Campaign</th>
                  <th style={th}>Company</th>
                  <th style={th}>Contact</th>
                </tr>
              </thead>
              <tbody>
                {warmLeads.map((r, i) => (
                  <tr key={`${r.replied_at}-${i}`}>
                    <td style={td}>{String(r.replied_at)}</td>
                    <td style={td}>{r.campaign_id ? <Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name || r.campaign_id}</Link> : '-'}</td>
                    <td style={td}>{r.company_name || '-'}</td>
                    <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Upcoming queue</h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Najbliższe rzeczy do wysyłki / follow-upu.</div>
              </div>
              <Link href="/queue">Cała kolejka →</Link>
            </div>
            <Table>
              <thead>
                <tr>
                  <th style={th}>Next run</th>
                  <th style={th}>Campaign</th>
                  <th style={th}>Company</th>
                  <th style={th}>Attempt</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{String(r.next_run_at)}</td>
                    <td style={td}><Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name}</Link></td>
                    <td style={td}>{r.company_name || '-'}</td>
                    <td style={td}>{r.contact_attempt_no ?? '-'}{r.email ? ` · ${r.email}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>
      </AppShell>
    );
  } catch (e) {
    return (
      <AppShell title="Dashboard" subtitle="Błąd ładowania danych z bazy.">
        <Card>
          <p style={{ marginTop: 0 }}>Brak tabel / brak danych jeszcze. Najpierw wgraj schema do Postgresa albo sprawdź DATABASE_URL.</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12, borderRadius: 12 }}>
            {String(e?.message || e)}
          </pre>
        </Card>
      </AppShell>
    );
  }
}
