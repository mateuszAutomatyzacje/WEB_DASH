import { getSql } from '@/lib/db.js';
import { getLeadExportDigestStatus, runLeadExportDigest } from '@/lib/export-digest.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'send_now').trim();
    if (!['send_now', 'test'].includes(action)) throw new Error('invalid action');

    const sql = getSql();
    const result = await runLeadExportDigest(sql, {
      manual: action === 'send_now',
      test: action === 'test',
      source: action === 'test' ? 'api_export_digest_test' : 'api_export_digest_manual',
    });
    const status = await getLeadExportDigestStatus(sql);

    return Response.json({
      ok: true,
      action,
      result,
      status,
    });
  } catch (error) {
    return new Response(String(error?.message || error), { status: 400 });
  }
}
