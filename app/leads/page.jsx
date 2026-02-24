import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function LeadsPage() {
  const sql = getSql();
  const rows = await sql`
    select
      id,
      status::text as status,
      email,
      phone,
      domain,
      company_name,
      person_full_name,
      created_at,
      updated_at
    from leads
    order by updated_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Leads (latest 200)</h1>
      <p><Link href="/">← Overview</Link></p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>person</th>
            <th style={th}>company</th>
            <th style={th}>email</th>
            <th style={th}>status</th>
            <th style={th}>updated_at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.person_full_name || '-'}</td>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{r.email || r.domain || r.phone || '-'}</td>
              <td style={td}>{r.status}</td>
              <td style={td}>{String(r.updated_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={5}>No leads</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
