import { getSql } from '@/lib/db.js';
import { listLeadExportRows, normalizeLeadExportFilters } from '@/lib/lead-export.js';

export const dynamic = 'force-dynamic';

function csvEscape(value) {
  const str = String(value ?? '');
  if (!/[",\n]/.test(str)) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mapExportRow(row) {
  return {
    campaign_name: row.campaign_name || '',
    company_name: row.company_name || '',
    developer_needed: row.developer_needed || '',
    job_url: row.job_url || '',
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    email: row.email || '',
    linkedin_url: row.linkedin_url || '',
    contact_title: row.contact_title || '',
    seniority: row.seniority || '',
    department: row.department || '',
    phone: row.phone || '',
    campaign_state: row.campaign_state || '',
    contact_attempt_no: row.contact_attempt_no ?? '',
    next_run_at: row.next_run_at || '',
    lead_city: row.lead_city || '',
    lead_country: row.lead_country || '',
    contact_city: row.contact_city || '',
    contact_country: row.contact_country || '',
    website_url: row.website_url || '',
    domain: row.domain || '',
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const format = String(searchParams.get('format') || 'csv').trim().toLowerCase();
    const filters = normalizeLeadExportFilters({
      campaign_id: searchParams.get('campaign_id') || 'all',
      scope: searchParams.get('scope') || 'campaign_contacts',
      email: searchParams.get('email') || 'with_email',
      updated: searchParams.get('updated') || 'all',
      limit: searchParams.get('limit') || 5000,
    }, { defaultLimit: 5000 });

    const sql = getSql();
    const rows = await listLeadExportRows(sql, filters, { limit: filters.limit });
    const mapped = rows.map(mapExportRow);

    if (format === 'json') {
      return Response.json({
        ok: true,
        count: mapped.length,
        filters,
        rows: mapped,
      });
    }

    if (format === 'xls') {
      const headers = Object.keys(mapped[0] || mapExportRow({}));
      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: Arial, sans-serif; }
              table { border-collapse: collapse; width: 100%; }
              th, td { border: 1px solid #ccc; padding: 6px 8px; }
              th { background: #f4f4f4; }
            </style>
          </head>
          <body>
            <h1>Lead export</h1>
            <p>Generated: ${htmlEscape(new Date().toISOString())}</p>
            <table>
              <tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr>
              ${mapped.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header])}</td>`).join('')}</tr>`).join('')}
            </table>
          </body>
        </html>
      `;

      return new Response(html, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': `attachment; filename="lead-export-${new Date().toISOString().slice(0, 10)}.xls"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const headers = Object.keys(mapped[0] || mapExportRow({}));
    const csv = [
      headers.join(','),
      ...mapped.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
    ].join('\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lead-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(String(error?.message || error), { status: 400 });
  }
}
