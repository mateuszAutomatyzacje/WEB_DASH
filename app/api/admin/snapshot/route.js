import { getSql } from '@/lib/db.js';
import { computeLiveMetrics } from '@/lib/metrics.js';
// auth disabled for now

function todayISO() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST(req) {
  try {
    const sql = getSql();
    const snapshot_date = todayISO();
    const metrics = await computeLiveMetrics(sql);

    await sql`
      insert into report_snapshots (snapshot_date, scope, metrics)
      values (${snapshot_date}::date, 'global', ${sql.json(metrics)})
      on conflict (snapshot_date, scope)
      do update set metrics = excluded.metrics
    `;

    return Response.json({ ok: true, snapshot_date, scope: 'global' });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
