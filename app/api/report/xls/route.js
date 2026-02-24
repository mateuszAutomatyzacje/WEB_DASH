import { getSql } from '@/lib/db.js';
import { computeLiveMetrics } from '@/lib/metrics.js';

export const dynamic = 'force-dynamic';

function htmlEscape(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toRows(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([k, v]) => ({ k, v }));
}

export async function GET() {
  const sql = getSql();

  // Prefer latest snapshot; fallback to live.
  const latest = await sql`
    select snapshot_date, scope, metrics
    from report_snapshots
    where scope = 'global'
    order by snapshot_date desc
    limit 1
  `;

  let snapshot_date = null;
  let metrics = null;
  let source = 'live';

  if (latest.length) {
    snapshot_date = latest[0].snapshot_date;
    metrics = latest[0].metrics;
    source = 'snapshot';
  } else {
    metrics = await computeLiveMetrics(sql);
    source = metrics?.source || 'live';
  }

  const leadCounts = toRows(metrics?.lead_counts);
  const campaignCounts = toRows(metrics?.campaign_counts);
  const queueByState = toRows(metrics?.queue_by_state);
  const assignmentByStatus = toRows(metrics?.assignment_by_status);
  const eventCounts = toRows(metrics?.message_event_counts);

  const html = `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; }
        th { background: #f4f4f4; }
        h1,h2 { margin: 8px 0; }
      </style>
    </head>
    <body>
      <h1>LeadGuard report</h1>
      <p>source: ${htmlEscape(source)} ${snapshot_date ? `(snapshot_date=${htmlEscape(snapshot_date)})` : ''}</p>

      <h2>KPIs</h2>
      <table>
        <tr><th>metric</th><th>value</th></tr>
        <tr><td>leads_total</td><td>${htmlEscape(metrics?.leads_total)}</td></tr>
        <tr><td>campaigns_total</td><td>${htmlEscape(metrics?.campaigns_total)}</td></tr>
        <tr><td>queue_total</td><td>${htmlEscape(metrics?.queue_total)}</td></tr>
        <tr><td>assignments_total</td><td>${htmlEscape(metrics?.assignments_total)}</td></tr>
        <tr><td>workers_total</td><td>${htmlEscape(metrics?.workers_total)}</td></tr>
      </table>

      <h2>Lead counts</h2>
      <table>
        <tr><th>status</th><th>count</th></tr>
        ${leadCounts.map(r => `<tr><td>${htmlEscape(r.k)}</td><td>${htmlEscape(r.v)}</td></tr>`).join('')}
      </table>

      <h2>Campaign counts</h2>
      <table>
        <tr><th>status</th><th>count</th></tr>
        ${campaignCounts.map(r => `<tr><td>${htmlEscape(r.k)}</td><td>${htmlEscape(r.v)}</td></tr>`).join('')}
      </table>

      <h2>Queue by state</h2>
      <table>
        <tr><th>state</th><th>count</th></tr>
        ${queueByState.map(r => `<tr><td>${htmlEscape(r.k)}</td><td>${htmlEscape(r.v)}</td></tr>`).join('')}
      </table>

      <h2>Assignments by status</h2>
      <table>
        <tr><th>status</th><th>count</th></tr>
        ${assignmentByStatus.map(r => `<tr><td>${htmlEscape(r.k)}</td><td>${htmlEscape(r.v)}</td></tr>`).join('')}
      </table>

      <h2>Message events</h2>
      <table>
        <tr><th>event_type</th><th>count</th></tr>
        ${eventCounts.map(r => `<tr><td>${htmlEscape(r.k)}</td><td>${htmlEscape(r.v)}</td></tr>`).join('')}
      </table>
    </body>
  </html>
  `;

  const filename = `leadguard-report-${new Date().toISOString().slice(0, 10)}.xls`;

  return new Response(html, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
