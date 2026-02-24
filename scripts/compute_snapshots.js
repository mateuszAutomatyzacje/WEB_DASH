import { getSql } from '../lib/db.js';
import { computeLiveMetrics } from '../lib/metrics.js';

function todayISO() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const snapshot_date = todayISO();

const sql = getSql();
const metrics = await computeLiveMetrics(sql);

await sql`
  insert into report_snapshots (snapshot_date, scope, metrics)
  values (${snapshot_date}::date, 'global', ${sql.json(metrics)})
  on conflict (snapshot_date, scope)
  do update set metrics = excluded.metrics
`;

console.log(JSON.stringify({ ok: true, snapshot_date, scope: 'global', metrics }, null, 2));
process.exit(0);
