import Link from 'next/link';
import { AppShell, Card, FilterForm, FiltersGrid, Field, Table, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { formatDateTime } from '@/lib/time.js';

export const dynamic = 'force-dynamic';

function normalize(searchParams) {
  const campaign = String(searchParams?.campaign || '').trim();
  const state = String(searchParams?.state || 'all');
  const due = String(searchParams?.due || 'all');
  return {
    campaign,
    state: ['all', 'new', 'enriched', 'in_campaign', 'stopped', 'closed', 'invalid', 'konkurencja'].includes(state) ? state : 'all',
    due: ['all', 'overdue', 'today', 'next24h'].includes(due) ? due : 'all',
  };
}

export default async function QueuePage({ searchParams }) {
  const sql = getSql();
  const resolvedSearchParams = await searchParams;
  const filters = normalize(resolvedSearchParams);
  const campaignFilter = filters.campaign ? `%${filters.campaign}%` : null;
  const stateFilter = filters.state === 'all' ? null : filters.state;

  const [summary] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where next_run_at <= now())::int as overdue,
      count(*) filter (where next_run_at > now() and next_run_at <= now() + interval '24 hours')::int as next_24h,
      min(next_run_at) as next_eta
    from public.campaign_leads
    where next_run_at is not null
      and state in ('in_campaign','new','enriched')
  `;

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
      la.to_email::text as email,
      lc.first_name,
      lc.last_name
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    join public.leads l on l.id = cl.lead_id
    left join lateral (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.to_email
      from public.message_attempts ma
      where ma.lead_id = cl.lead_id
        and ma.lead_contact_id = cl.active_contact_id
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    ) la on true
    left join public.lead_contacts lc on lc.id = cl.active_contact_id
    where cl.next_run_at is not null
      and cl.state in ('in_campaign','new','enriched')
      and (${campaignFilter}::text is null or coalesce(c.name, '') ilike ${campaignFilter})
      and (${stateFilter}::text is null or cl.state::text = ${stateFilter})
      and (
        ${filters.due} = 'all'
        or (${filters.due} = 'overdue' and cl.next_run_at <= now())
        or (${filters.due} = 'today' and cl.next_run_at::date = current_date)
        or (${filters.due} = 'next24h' and cl.next_run_at > now() and cl.next_run_at <= now() + interval '24 hours')
      )
    order by cl.next_run_at asc
    limit 300
  `;

  return (
    <AppShell title="Queue" subtitle="Biznesowy widok kolejki: co jest overdue, co leci dziś i które follow-upy są najbliżej wysyłki.">
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Total queued</div><div style={{ fontSize: 30, fontWeight: 800 }}>{summary?.total ?? 0}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Overdue</div><div style={{ fontSize: 30, fontWeight: 800, color: '#fca5a5' }}>{summary?.overdue ?? 0}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Next 24h</div><div style={{ fontSize: 30, fontWeight: 800 }}>{summary?.next_24h ?? 0}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Next ETA</div><div style={{ fontSize: 20, fontWeight: 800 }}>{formatDateTime(summary?.next_eta)}</div></Card>
      </section>

      <FilterForm>
        <FiltersGrid>
          <Field label="Campaign">
            <input name="campaign" defaultValue={filters.campaign} placeholder="np. evergreen" style={inputStyle} />
          </Field>
          <Field label="State">
            <select name="state" defaultValue={filters.state} style={inputStyle}>
              <option value="all">all</option>
              <option value="new">new</option>
              <option value="enriched">enriched</option>
              <option value="in_campaign">in_campaign</option>
            </select>
          </Field>
          <Field label="Due window">
            <select name="due" defaultValue={filters.due} style={inputStyle}>
              <option value="all">all</option>
              <option value="overdue">overdue</option>
              <option value="today">today</option>
              <option value="next24h">next 24h</option>
            </select>
          </Field>
          <Field label="Run filters">
            <button type="submit" style={{ ...inputStyle, cursor: 'pointer', fontWeight: 700 }}>Apply filters</button>
          </Field>
        </FiltersGrid>
      </FilterForm>

      <Card>
        <Table>
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
                <td style={{ ...td, color: new Date(r.next_run_at) <= new Date() ? '#fca5a5' : '#f8fafc' }}>{formatDateTime(r.next_run_at)}</td>
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
        </Table>
      </Card>
    </AppShell>
  );
}
