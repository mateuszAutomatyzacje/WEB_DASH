import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px', verticalAlign: 'top' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function WarmLeadsPage() {
  const sql = getSql();

  const rows = await sql`
    with replied as (
      select
        ma.lead_id,
        ma.lead_contact_id,
        ma.campaign_id,
        max(me.created_at) as replied_at
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where me.event_type = 'replied'
      group by ma.lead_id, ma.lead_contact_id, ma.campaign_id
    )
    select
      r.replied_at,
      l.id as lead_id,
      l.company_name,
      c.id as campaign_id,
      c.name as campaign_name,
      lc.first_name,
      lc.last_name,
      lc.email
    from replied r
    join public.leads l on l.id = r.lead_id
    left join public.campaigns c on c.id = r.campaign_id
    left join public.lead_contacts lc on lc.id = r.lead_contact_id
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
            <th style={th}>company</th>
            <th style={th}>contact</th>
            <th style={th}>email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.lead_id}-${r.campaign_id || 'none'}-${i}`}>
              <td style={td}>{String(r.replied_at)}</td>
              <td style={td}>{r.campaign_id ? <Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name || r.campaign_id}</Link> : '-'}</td>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '-'}</td>
              <td style={td}>{r.email || '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={5}>No replied leads yet</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
