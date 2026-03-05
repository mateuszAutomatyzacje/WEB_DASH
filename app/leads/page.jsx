import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px', verticalAlign: 'top' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function LeadsPage() {
  const sql = getSql();

  const rows = await sql`
    select
      l.id as lead_id,
      l.company_name,
      l.domain,
      l.website_url,
      l.status::text as lead_status,
      l.updated_at,
      count(lc.id)::int as contacts_total,
      count(lc.id) filter (where lc.email is not null)::int as contacts_with_email,
      count(distinct lce.lead_contact_id)::int as enriched_contacts
    from public.leads l
    left join public.lead_contacts lc on lc.lead_id = l.id
    left join public.lead_contact_enrichments lce on lce.lead_contact_id = lc.id and coalesce(lce.ok, true) = true
    group by l.id
    order by l.updated_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Leads (firmy)</h1>
      <p><Link href="/">← Overview</Link></p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>company</th>
            <th style={th}>domain</th>
            <th style={th}>status</th>
            <th style={th}>contacts</th>
            <th style={th}>with_email</th>
            <th style={th}>enriched</th>
            <th style={th}>updated_at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lead_id}>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{r.domain || r.website_url || '-'}</td>
              <td style={td}>{r.lead_status}</td>
              <td style={td}>{r.contacts_total ?? 0}</td>
              <td style={td}>{r.contacts_with_email ?? 0}</td>
              <td style={td}>{r.enriched_contacts ?? 0}</td>
              <td style={td}>{String(r.updated_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={7}>No leads</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
