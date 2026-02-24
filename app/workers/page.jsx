import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function WorkersPage() {
  const sql = getSql();
  const workers = await sql`
    select id, handle, display_name, is_active, created_at
    from workers
    order by is_active desc, created_at desc
    limit 200
  `;

  const assignments = await sql`
    select
      a.id,
      a.status::text as status,
      a.sla_due_at,
      a.created_at,
      w.handle as worker_handle,
      l.person_full_name,
      l.company_name,
      l.email,
      c.name as campaign_name
    from lead_assignments a
    join workers w on w.id = a.worker_id
    join leads l on l.id = a.lead_id
    left join campaigns c on c.id = a.campaign_id
    order by a.updated_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Workers + Assignments</h1>
      <p><Link href="/">← Overview</Link></p>

      <h2>Workers</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={th}>handle</th>
            <th style={th}>display_name</th>
            <th style={th}>active</th>
            <th style={th}>created_at</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.id}>
              <td style={td}>{w.handle}</td>
              <td style={td}>{w.display_name || '-'}</td>
              <td style={td}>{w.is_active ? 'yes' : 'no'}</td>
              <td style={td}>{String(w.created_at)}</td>
            </tr>
          ))}
          {workers.length === 0 && <tr><td style={td} colSpan={4}>No workers</td></tr>}
        </tbody>
      </table>

      <h2>Assignments (latest 200)</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>worker</th>
            <th style={th}>lead</th>
            <th style={th}>email</th>
            <th style={th}>campaign</th>
            <th style={th}>status</th>
            <th style={th}>sla_due_at</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id}>
              <td style={td}>{a.worker_handle}</td>
              <td style={td}>{a.person_full_name || a.company_name || '-'}</td>
              <td style={td}>{a.email || '-'}</td>
              <td style={td}>{a.campaign_name || '-'}</td>
              <td style={td}>{a.status}</td>
              <td style={td}>{a.sla_due_at ? String(a.sla_due_at) : '-'}</td>
            </tr>
          ))}
          {assignments.length === 0 && <tr><td style={td} colSpan={6}>No assignments</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
