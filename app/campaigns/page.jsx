import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function CampaignsPage() {
  const sql = getSql();
  const rows = await sql`
    select
      c.id,
      c.name,
      c.status::text as status,
      c.created_at,
      count(cl.id)::int as leads_total,
      count(cl.id) filter (where cl.state in ('queued','in_campaign'))::int as active_in_queue,
      count(cl.id) filter (where cl.stop_reason = 'replied')::int as replied
    from campaigns c
    left join campaign_leads cl on cl.campaign_id = c.id
    group by c.id
    order by c.created_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Campaigns</h1>
      <p><Link href="/">← Overview</Link></p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>name</th>
            <th style={th}>status</th>
            <th style={th}>leads_total</th>
            <th style={th}>active_in_queue</th>
            <th style={th}>replied</th>
            <th style={th}>created_at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}><Link href={`/campaigns/${r.id}`}>{r.name}</Link></td>
              <td style={td}>{r.status}</td>
              <td style={td}>{r.leads_total}</td>
              <td style={td}>{r.active_in_queue}</td>
              <td style={td}>{r.replied}</td>
              <td style={td}>{String(r.created_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={6}>No campaigns</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
