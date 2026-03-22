import { getSql } from '@/lib/db.js';
import {
  buildLeadExportCsv,
  buildLeadExportXlsHtml,
  listLeadExportRows,
  mapLeadExportRow,
  normalizeLeadExportFilters,
} from '@/lib/lead-export.js';

export const dynamic = 'force-dynamic';

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
    const mapped = rows.map(mapLeadExportRow);

    if (format === 'json') {
      return Response.json({
        ok: true,
        count: mapped.length,
        filters,
        rows: mapped,
      });
    }

    if (format === 'xls') {
      const html = buildLeadExportXlsHtml(rows, new Date().toISOString());

      return new Response(html, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': `attachment; filename="lead-export-${new Date().toISOString().slice(0, 10)}.xls"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const csv = buildLeadExportCsv(rows);

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
