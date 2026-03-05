import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

export default async function WorkersPage() {
  const sql = getSql();

  const events = await sql`
    select
      me.event_type::text as event_type,
      count(*)::int as total,
      max(me.created_at) as latest_at
    from public.message_events me
    group by me.event_type
    order by total desc
  `;

  const recent = await sql`
    select
      me.created_at,
      me.event_type::text as event_type,
      l.company_name,
      lc.email,
      c.name as campaign_name
    from public.message_events me
    join public.message_attempts ma on ma.id = me.message_attempt_id
    join public.leads l on l.id = ma.lead_id
    left join public.lead_contacts lc on lc.id = ma.lead_contact_id
    left join public.campaigns c on c.id = ma.campaign_id
    order by me.created_at desc
    limit 200
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Workers / Operations</h1>
      <p><Link href="/">← Overview</Link></p>
      <p style={{ fontSize: 13, color: '#555' }}>
        W aktualnym schemacie nie ma tabel <code>workers</code>/<code>lead_assignments</code>, więc ta podstrona pokazuje operacyjne zdarzenia wiadomości.
      </p>

      <h2>Event summary</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead>
          <tr>
            <th style={th}>event_type</th>
            <th style={th}>count</th>
            <th style={th}>latest_at</th>
          </tr>
        </thead>
        <tbody>
          {events.map((r) => (
            <tr key={r.event_type}>
              <td style={td}>{r.event_type}</td>
              <td style={td}>{r.total}</td>
              <td style={td}>{r.latest_at ? String(r.latest_at) : '-'}</td>
            </tr>
          ))}
          {events.length === 0 && <tr><td style={td} colSpan={3}>No events</td></tr>}
        </tbody>
      </table>

      <h2>Recent events</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>created_at</th>
            <th style={th}>event</th>
            <th style={th}>campaign</th>
            <th style={th}>company</th>
            <th style={th}>email</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={`${r.created_at}-${i}`}>
              <td style={td}>{String(r.created_at)}</td>
              <td style={td}>{r.event_type}</td>
              <td style={td}>{r.campaign_name || '-'}</td>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{r.email || '-'}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td style={td} colSpan={5}>No recent events</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
