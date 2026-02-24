import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px', verticalAlign: 'top' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function WarmLeadsPage() {
  const sql = getSql();

  // Definition: warm lead = message_events.event_type = 'replied'
  // We show the latest reply per lead+campaign and who it was assigned to (if any).
  const rows = await sql`
    with replied as (
      select
        ma.lead_id,
        ma.campaign_id,
        max(me.created_at) as replied_at
      from message_attempts ma
      join message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
      group by ma.lead_id, ma.campaign_id
    ), latest_assignment as (
      select distinct on (a.lead_id, coalesce(a.campaign_id::text,'-'))
        a.lead_id,
        a.campaign_id,
        a.status::text as assignment_status,
        a.created_at as assigned_at,
        w.handle as worker_handle
      from lead_assignments a
      join workers w on w.id = a.worker_id
      order by a.lead_id, coalesce(a.campaign_id::text,'-'), a.created_at desc
    )
    select
      r.replied_at,
      c.id as campaign_id,
      c.name as campaign_name,
      l.id as lead_id,
      l.person_full_name,
      l.company_name,
      l.email,
      la.worker_handle,
      la.assignment_status,
      la.assigned_at
    from replied r
    join leads l on l.id = r.lead_id
    left join campaigns c on c.id = r.campaign_id
    left join latest_assignment la on la.lead_id = r.lead_id and ( (la.campaign_id is null and r.campaign_id is null) or la.campaign_id = r.campaign_id )
    order by r.replied_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Warm leads (replied)</h1>
      <p><Link href="/">← Overview</Link></p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>replied_at</th>
            <th style={th}>campaign</th>
            <th style={th}>lead</th>
            <th style={th}>email</th>
            <th style={th}>assigned_to</th>
            <th style={th}>assignment_status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.lead_id}-${r.campaign_id}-${r.replied_at}`}> 
              <td style={td}>{String(r.replied_at)}</td>
              <td style={td}>
                {r.campaign_id ? <Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name || r.campaign_id}</Link> : '-'}
              </td>
              <td style={td}>{r.person_full_name || r.company_name || r.lead_id}</td>
              <td style={td}>{r.email || '-'}</td>
              <td style={td}>{r.worker_handle || '-'}</td>
              <td style={td}>{r.assignment_status || '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={6}>No replied leads yet</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
