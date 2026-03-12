import { getSql } from '@/lib/db.js';
import { getAnalyticsSnapshot } from '@/lib/reporting.js';

export const dynamic = 'force-dynamic';

function htmlEscape(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function GET() {
  const sql = getSql();
  const analytics = await getAnalyticsSnapshot(sql);

  const html = `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; margin: 10px 0; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; }
        th { background: #f4f4f4; }
      </style>
    </head>
    <body>
      <h1>LeadGuard analytics export</h1>
      <p>Generated: ${htmlEscape(new Date().toISOString())}</p>

      <h2>Efficiency analytics</h2>
      <table>
        <tr><th>metric</th><th>value</th></tr>
        <tr><td>Outbound</td><td>${htmlEscape(analytics.totals.outbound)}</td></tr>
        <tr><td>Opened</td><td>${htmlEscape(analytics.totals.opened)}</td></tr>
        <tr><td>Clicked</td><td>${htmlEscape(analytics.totals.clicked)}</td></tr>
        <tr><td>Replied</td><td>${htmlEscape(analytics.totals.replied)}</td></tr>
        <tr><td>Bounced</td><td>${htmlEscape(analytics.totals.bounced)}</td></tr>
        <tr><td>Failed</td><td>${htmlEscape(analytics.totals.failed)}</td></tr>
        <tr><td>Open Rate</td><td>${htmlEscape(analytics.totals.open_rate)}%</td></tr>
        <tr><td>CTR</td><td>${htmlEscape(analytics.totals.ctr)}%</td></tr>
        <tr><td>Reply Rate</td><td>${htmlEscape(analytics.totals.reply_rate)}%</td></tr>
        <tr><td>Bounce Rate</td><td>${htmlEscape(analytics.totals.bounce_rate)}%</td></tr>
      </table>

      <h2>Daily chart data</h2>
      <table>
        <tr><th>day</th><th>sent</th><th>replied</th></tr>
        ${analytics.dailySeries.map((r) => `<tr><td>${htmlEscape(r.day)}</td><td>${htmlEscape(r.sent)}</td><td>${htmlEscape(r.replied)}</td></tr>`).join('')}
      </table>

      <h2>SMTP account load</h2>
      <table>
        <tr><th>account</th><th>from_email</th><th>status</th><th>daily_limit</th><th>sent_today</th><th>failed_today</th><th>remaining_today</th><th>load_pct</th></tr>
        ${analytics.smtpLoad.map((r) => `<tr><td>${htmlEscape(r.account_key)}</td><td>${htmlEscape(r.from_email)}</td><td>${htmlEscape(r.status)}</td><td>${htmlEscape(r.daily_limit)}</td><td>${htmlEscape(r.sent_today)}</td><td>${htmlEscape(r.failed_today)}</td><td>${htmlEscape(r.remaining_today)}</td><td>${htmlEscape(r.load_pct ?? 0)}%</td></tr>`).join('')}
      </table>

      <h2>Error logs</h2>
      <table>
        <tr><th>created_at</th><th>campaign</th><th>account</th><th>to_email</th><th>subject</th><th>error</th></tr>
        ${analytics.errorLogs.map((r) => `<tr><td>${htmlEscape(r.created_at)}</td><td>${htmlEscape(r.campaign_name)}</td><td>${htmlEscape(r.account_key)}</td><td>${htmlEscape(r.to_email)}</td><td>${htmlEscape(r.subject)}</td><td>${htmlEscape(r.error)}</td></tr>`).join('')}
      </table>
    </body>
  </html>`;

  const filename = `leadguard-report-${new Date().toISOString().slice(0, 10)}.xls`;
  return new Response(html, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
