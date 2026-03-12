import PDFDocument from 'pdfkit';
import { getSql } from '@/lib/db.js';
import { getAnalyticsSnapshot } from '@/lib/reporting.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = getSql();
  const analytics = await getAnalyticsSnapshot(sql);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  doc.fontSize(20).text('LeadGuard analytics report');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown();
  doc.fillColor('#000');

  const lines = [
    ['Outbound', analytics.totals.outbound],
    ['Open rate', `${analytics.totals.open_rate}%`],
    ['CTR', `${analytics.totals.ctr}%`],
    ['Reply rate', `${analytics.totals.reply_rate}%`],
    ['Bounce rate', `${analytics.totals.bounce_rate}%`],
    ['Failure rate', `${analytics.totals.failure_rate}%`],
  ];
  lines.forEach(([k, v]) => doc.fontSize(12).text(`${k}: ${v}`));

  doc.moveDown();
  doc.fontSize(14).text('SMTP accounts');
  analytics.smtpLoad.slice(0, 12).forEach((row) => {
    doc.fontSize(10).text(`${row.account_key} | ${row.status} | sent today ${row.sent_today}/${row.daily_limit} | remaining ${row.remaining_today} | load ${row.load_pct ?? 0}%`);
  });

  doc.moveDown();
  doc.fontSize(14).text('Recent failed sends');
  analytics.errorLogs.slice(0, 20).forEach((row) => {
    doc.fontSize(9).text(`${row.created_at} | ${row.account_key} | ${row.campaign_name} | ${row.to_email} | ${row.error}`);
  });

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  const buffer = Buffer.concat(chunks);

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="leadguard-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
