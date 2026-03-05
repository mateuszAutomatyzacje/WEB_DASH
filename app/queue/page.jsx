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
      cl.next_run_at,
      cl.state::text as state,
      cl.contact_attempt_no,
      cl.stop_reason::text as stop_reason,
      c.name as campaign_name,
      c.id as campaign_id,
      l.company_name,
      lc.email,
      lc.first_name,
      lc.last_name
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    join public.leads l on l.id = cl.lead_id
    left join public.lead_contacts lc on lc.id = cl.active_contact_id
    where cl.next_run_at is not null
      and cl.state in ('in_campaign','new','enriched')
    order by cl.next_run_at asc
    limit 300
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
            <th style={th}>company</th>
            <th style={th}>contact/email</th>
            <th style={th}>state</th>
            <th style={th}>attempt_no</th>
            <th style={th}>stop_reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{String(r.next_run_at)}</td>
              <td style={td}><Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name}</Link></td>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '-'}</td>
              <td style={td}>{r.state}</td>
              <td style={td}>{r.contact_attempt_no ?? '-'}</td>
              <td style={td}>{r.stop_reason || '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={7}>Queue empty</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
