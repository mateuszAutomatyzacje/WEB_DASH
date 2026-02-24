import Link from 'next/link';
import AdminButton from '@/app/components/AdminButton.jsx';
import { getSql } from '@/lib/db.js';
import { computeLiveMetrics } from '@/lib/metrics.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

function Nav() {
  return (
    <nav style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
      <Link href="/">Overview</Link>
      <Link href="/campaigns">Campaigns</Link>
      <Link href="/leads">Leads</Link>
      <Link href="/queue">Queue</Link>
      <Link href="/workers">Workers</Link>
      <Link href="/warm-leads">Warm leads</Link>
      <a href="/api/health">/api/health</a>
    </nav>
  );
}

async function getOverviewData() {
  const sql = getSql();
  const latest = await sql`
    select snapshot_date, scope, metrics, created_at
    from report_snapshots
    where scope = 'global'
    order by snapshot_date desc, created_at desc
    limit 1
  `;

  if (latest.length > 0) {
    return {
      source: 'snapshot',
      snapshot_date: latest[0].snapshot_date,
      created_at: latest[0].created_at,
      metrics: latest[0].metrics,
    };
  }

  return {
    source: 'live',
    metrics: await computeLiveMetrics(getSql()),
  };
}

function renderMapTable(title, mapObj = {}) {
  const rows = Object.entries(mapObj);
  return (
    <section>
      <h3>{title}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>key</th>
            <th style={th}>count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, count]) => (
            <tr key={key}>
              <td style={td}>{key}</td>
              <td style={td}>{count}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={2}>No data</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default async function Page() {
  try {
    const overview = await getOverviewData();
    const metrics = overview.metrics || {};
    const totals = metrics.totals || {};
    const queue = metrics.queue || {};
    const msg = metrics.message_attempts || {};

    return (
      <main style={{ padding: 24 }}>
        <h1>LeadGuard Dashboard</h1>
        <Nav />

        <p style={{ color: '#444' }}>
          Source: <b>{overview.source}</b>
          {overview.snapshot_date ? ` | snapshot_date: ${String(overview.snapshot_date)}` : ''}
        </p>

        <h2>KPIs</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Admin:</span>
          <AdminButton
            label="Generate snapshot now"
            action="/api/admin/snapshot"
            confirmText="Wygenerować snapshot (report_snapshots) teraz?"
          />
          <a href="/api/report/xls" style={{ fontSize: 12 }}>Download report XLS</a>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 22 }}>
          <tbody>
            {[
              ['Leads total', totals.leads_total],
              ['Campaigns total', totals.campaigns_total],
              ['Campaign-Leads total', totals.campaign_leads_total],
              ['Assignments open', totals.assignments_open],
              ['Assignments overdue', totals.assignments_overdue],
              ['Workers active', totals.workers_active],
              ['Queue total', queue.queued_total],
              ['Queue ready now', queue.ready_now],
              ['Attempts outbound', msg.attempts_outbound],
              ['Attempts sent', msg.attempts_sent],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={td}>{k}</td>
                <td style={td}>{v ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {renderMapTable('Lead counts', metrics.lead_counts)}
          {renderMapTable('Campaign counts', metrics.campaign_counts)}
          {renderMapTable('Assignment counts', metrics.assignment_counts)}
          {renderMapTable('Message event counts', metrics.message_event_counts)}
        </div>
      </main>
    );
  } catch (e) {
    return (
      <main style={{ padding: 24 }}>
        <h1>LeadGuard Dashboard</h1>
        <Nav />
        <p>Brak tabel / brak danych jeszcze. Najpierw wgraj schema do Postgresa.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12, borderRadius: 8 }}>
          {String(e?.message || e)}
        </pre>
      </main>
    );
  }
}
