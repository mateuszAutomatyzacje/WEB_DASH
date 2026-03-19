import { getSql } from '@/lib/db.js';
import { listApplicationLogEntries, summarizeApplicationLogEntries } from '@/lib/application-logs.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') || 160);
    const sql = getSql();
    const entries = await listApplicationLogEntries(sql, { limit });

    return Response.json({
      ok: true,
      refreshed_at: new Date().toISOString(),
      summary: summarizeApplicationLogEntries(entries),
      entries,
    });
  } catch (error) {
    return new Response(String(error?.message || error), { status: 400 });
  }
}
