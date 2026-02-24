import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function QueuePage() {
  const sql = getSql();
  const rows = await sql`
    select
      cl.id,
      cl.state::text as state,
      cl.current_step_no,
      cl.next_run_at,
      cl.stop_reason::text as stop_reason,
      c.name as campaign_name,
      c.id as campaign_id,
      l.person_full_name,
      l.company_name,
      l.email
    from campaign_leads cl
    join campaigns c on c.id = cl.campaign_id
    join leads l on l.id = cl.lead_id
    where cl.next_run_at is not null
      and cl.state in ('queued','in_campaign')
    order by cl.next_run_at asc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Queue (next_run_at)</h1>
      <p><Link href="/">← Overview</Link></p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>next_run_at</th>
            <th style={th}>campaign</th>
            <th style={th}>lead</th>
            <th style={th}>email</th>
            <th style={th}>state</th>
            <th style={th}>step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{String(r.next_run_at)}</td>
              <td style={td}><Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name}</Link></td>
              <td style={td}>{r.person_full_name || r.company_name || '-'}</td>
              <td style={td}>{r.email || '-'}</td>
              <td style={td}>{r.state}</td>
              <td style={td}>{r.current_step_no ?? '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={6}>Queue empty</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
