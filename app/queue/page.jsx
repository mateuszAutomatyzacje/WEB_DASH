import Link from 'next/link';
import { AppShell, Card, Field, FilterForm, FiltersGrid, Table, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { formatDateTime } from '@/lib/time.js';
import { filterProjectedQueueRows, projectQueueRows, summarizeProjectedQueue } from '@/lib/queue-view.js';

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
  const now = new Date();
  const resolvedSearchParams = await searchParams;
  const filters = normalize(resolvedSearchParams);
  const campaignFilter = filters.campaign ? `%${filters.campaign}%` : null;
  const stateFilter = filters.state === 'all' ? null : filters.state;

  const rawRows = await sql`
    select
      cl.id,
      cl.next_run_at,
      cl.state::text as state,
      cl.contact_attempt_no,
      cl.stop_reason::text as stop_reason,
      c.name as campaign_name,
      c.id as campaign_id,
      c.status::text as campaign_status,
      c.settings as campaign_settings,
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
    order by cl.next_run_at asc
    limit 1000
  `;

  const projectedRows = projectQueueRows(rawRows, { now });
  const rows = filterProjectedQueueRows(projectedRows, filters.due, { now });
  const summary = summarizeProjectedQueue(rows, { now });

  return (
    <AppShell
      title="Queue"
      subtitle="Business queue view: ready_at comes from campaign_leads, send_eta is projected from send_email_interval_min and send_batch_limit."
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Total queued</div><div style={{ fontSize: 30, fontWeight: 800 }}>{summary.total}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Ready now</div><div style={{ fontSize: 30, fontWeight: 800, color: '#fca5a5' }}>{summary.ready_now}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Send ETA 24h</div><div style={{ fontSize: 30, fontWeight: 800 }}>{summary.next_24h}</div></Card>
        <Card><div style={{ fontSize: 13, color: '#94a3b8' }}>Next send ETA</div><div style={{ fontSize: 20, fontWeight: 800 }}>{formatDateTime(summary.next_eta)}</div></Card>
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
          <Field label="Send window">
            <select name="due" defaultValue={filters.due} style={inputStyle}>
              <option value="all">all</option>
              <option value="overdue">ready now</option>
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
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
          <b>ready_at</b> means the lead is eligible for send from the sequence. <b>send_eta</b> is the projected scheduler slot based on campaign cadence and batch size.
        </div>
        <Table>
          <thead>
            <tr>
              <th style={th}>ready_at</th>
              <th style={th}>send_eta</th>
              <th style={th}>campaign</th>
              <th style={th}>company</th>
              <th style={th}>contact/email</th>
              <th style={th}>state</th>
              <th style={th}>attempt_no</th>
              <th style={th}>stop_reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ ...td, color: row.ready_now ? '#fca5a5' : '#f8fafc' }}>
                  {formatDateTime(row.ready_at)}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{row.ready_now ? 'ready now' : 'scheduled'}</div>
                </td>
                <td style={td}>
                  {row.send_scheduler_enabled ? formatDateTime(row.projected_send_at) : 'auto-send paused'}
                  {row.send_scheduler_enabled ? (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                      slot {row.queue_slot_no ?? '-'} | every {row.send_email_interval_min} min | batch {row.send_batch_limit}
                    </div>
                  ) : null}
                </td>
                <td style={td}><Link href={`/campaigns/${row.campaign_id}`}>{row.campaign_name}</Link></td>
                <td style={td}>{row.company_name || '-'}</td>
                <td style={td}>{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || '-'}</td>
                <td style={td}>{row.state}</td>
                <td style={td}>{row.contact_attempt_no ?? '-'}</td>
                <td style={td}>{row.stop_reason || '-'}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td style={td} colSpan={8}>Queue empty</td></tr> : null}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  );
}
