import { sql } from '../lib/db.js';

// MVP snapshot job: counts per lead status + campaign status.
// Writes into report_snapshots for today's date.

function todayISO() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const snapshot_date = todayISO();

const leadCounts = await sql`
  select status::text as status, count(*)::int as count
  from leads
  group by status
  order by count desc
`;

const campaignCounts = await sql`
  select status::text as status, count(*)::int as count
  from campaigns
  group by status
  order by count desc
`;

const metrics = {
  lead_counts: Object.fromEntries(leadCounts.map(r => [r.status, r.count])),
  campaign_counts: Object.fromEntries(campaignCounts.map(r => [r.status, r.count])),
};

await sql`
  insert into report_snapshots (snapshot_date, scope, metrics)
  values (${snapshot_date}::date, 'global', ${sql.json(metrics)})
  on conflict (snapshot_date, scope)
  do update set metrics = excluded.metrics
`;

console.log(JSON.stringify({ ok: true, snapshot_date, scope: 'global', metrics }, null, 2));
process.exit(0);
