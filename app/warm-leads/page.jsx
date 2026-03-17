import Link from 'next/link';
import { AppShell, Card, FilterForm, FiltersGrid, Field, Pagination, Table, StatCard, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { formatDateTime } from '@/lib/time.js';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

function normalize(searchParams) {
  const campaign = String(searchParams?.campaign || '').trim();
  const handoff = String(searchParams?.handoff || 'all');
  const period = String(searchParams?.period || 'all');
  const pageRaw = Number(searchParams?.page || 1);
  return {
    campaign,
    handoff: ['all', 'unassigned', 'assigned', 'in_progress', 'done'].includes(handoff) ? handoff : 'all',
    period: ['all', 'today', '7d', '30d'].includes(period) ? period : 'all',
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
  };
}

function buildPeriodTimestamp(period) {
  if (period === 'today') return '1 day';
  if (period === '7d') return '7 days';
  if (period === '30d') return '30 days';
  return null;
}

async function detectAssignmentTables(sql) {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('lead_assignments', 'workers')
  `;
  const names = new Set(rows.map((r) => r.table_name));
  return names.has('lead_assignments') && names.has('workers');
}

async function getSummary(sql, hasAssignments) {
  if (hasAssignments) {
    const [summary] = await sql`
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
      ), latest_assignment as (
        select distinct on (la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
          la.lead_id,
          la.campaign_id,
          la.status::text as status
        from public.lead_assignments la
        order by la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), la.updated_at desc
      )
      select
        count(*)::int as total,
        count(*) filter (where la.status is null)::int as unassigned,
        count(*) filter (where la.status = 'assigned')::int as assigned,
        count(*) filter (where la.status = 'in_progress')::int as in_progress,
        count(*) filter (where la.status = 'done')::int as done
      from replied r
      left join latest_assignment la on la.lead_id = r.lead_id and coalesce(la.campaign_id, r.campaign_id) = r.campaign_id
    `;
    return summary || {};
  }

  const [summary] = await sql`
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
      count(*)::int as total,
      count(*)::int as unassigned,
      0::int as assigned,
      0::int as in_progress,
      0::int as done
    from replied
  `;
  return summary || {};
}

async function getRows(sql, filters, hasAssignments) {
  const campaignFilter = filters.campaign ? `%${filters.campaign}%` : null;
  const periodInterval = buildPeriodTimestamp(filters.period);
  const offset = (filters.page - 1) * PAGE_SIZE;

  if (hasAssignments) {
    return sql`
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
      ), latest_assignment as (
        select distinct on (la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
          la.lead_id,
          la.campaign_id,
          la.status::text as assignment_status,
          la.sla_due_at,
          w.display_name,
          w.handle
        from public.lead_assignments la
        left join public.workers w on w.id = la.worker_id
        order by la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), la.updated_at desc
      )
      select
        r.replied_at,
        l.id as lead_id,
        l.company_name,
        c.id as campaign_id,
        c.name as campaign_name,
        lc.first_name,
        lc.last_name,
        lc.email,
        la.assignment_status,
        la.sla_due_at,
        coalesce(la.display_name, la.handle) as owner,
        case
          when la.assignment_status is null then 'unassigned'
          else la.assignment_status
        end as pipeline_stage
      from replied r
      join public.leads l on l.id = r.lead_id
      left join public.campaigns c on c.id = r.campaign_id
      left join public.lead_contacts lc on lc.id = r.lead_contact_id
      left join latest_assignment la on la.lead_id = r.lead_id and coalesce(la.campaign_id, r.campaign_id) = r.campaign_id
      where (${campaignFilter}::text is null or coalesce(c.name, '') ilike ${campaignFilter})
        and (
          ${filters.handoff} = 'all'
          or (${filters.handoff} = 'unassigned' and la.assignment_status is null)
          or (${filters.handoff} <> 'unassigned' and coalesce(la.assignment_status, '') = ${filters.handoff})
        )
        and (
          ${periodInterval}::text is null
          or r.replied_at >= now() - (${periodInterval}::text)::interval
        )
      order by r.replied_at desc
      limit ${PAGE_SIZE} offset ${offset}
    `;
  }

  return sql`
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
      lc.email,
      null::text as assignment_status,
      null::timestamptz as sla_due_at,
      null::text as owner,
      'unassigned'::text as pipeline_stage
    from replied r
    join public.leads l on l.id = r.lead_id
    left join public.campaigns c on c.id = r.campaign_id
    left join public.lead_contacts lc on lc.id = r.lead_contact_id
    where (${campaignFilter}::text is null or coalesce(c.name, '') ilike ${campaignFilter})
      and (${filters.handoff} in ('all', 'unassigned'))
      and (
        ${periodInterval}::text is null
        or r.replied_at >= now() - (${periodInterval}::text)::interval
      )
    order by r.replied_at desc
    limit ${PAGE_SIZE} offset ${offset}
  `;
}

async function getCount(sql, filters, hasAssignments) {
  const campaignFilter = filters.campaign ? `%${filters.campaign}%` : null;
  const periodInterval = buildPeriodTimestamp(filters.period);

  if (hasAssignments) {
    const [countRow] = await sql`
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
      ), latest_assignment as (
        select distinct on (la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
          la.lead_id,
          la.campaign_id,
          la.status::text as assignment_status
        from public.lead_assignments la
        order by la.lead_id, coalesce(la.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), la.updated_at desc
      )
      select count(*)::int as total
      from replied r
      left join public.campaigns c on c.id = r.campaign_id
      left join latest_assignment la on la.lead_id = r.lead_id and coalesce(la.campaign_id, r.campaign_id) = r.campaign_id
      where (${campaignFilter}::text is null or coalesce(c.name, '') ilike ${campaignFilter})
        and (
          ${filters.handoff} = 'all'
          or (${filters.handoff} = 'unassigned' and la.assignment_status is null)
          or (${filters.handoff} <> 'unassigned' and coalesce(la.assignment_status, '') = ${filters.handoff})
        )
        and (
          ${periodInterval}::text is null
          or r.replied_at >= now() - (${periodInterval}::text)::interval
        )
    `;
    return countRow || { total: 0 };
  }

  const [countRow] = await sql`
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
    select count(*)::int as total
    from replied r
    left join public.campaigns c on c.id = r.campaign_id
    where (${campaignFilter}::text is null or coalesce(c.name, '') ilike ${campaignFilter})
      and (${filters.handoff} in ('all', 'unassigned'))
      and (
        ${periodInterval}::text is null
        or r.replied_at >= now() - (${periodInterval}::text)::interval
      )
  `;
  return countRow || { total: 0 };
}

export default async function WarmLeadsPage({ searchParams }) {
  const sql = getSql();
  const resolvedSearchParams = await searchParams;
  const filters = normalize(resolvedSearchParams);
  const hasAssignments = await detectAssignmentTables(sql);
  const [summary, rows, countRow] = await Promise.all([
    getSummary(sql, hasAssignments),
    getRows(sql, filters, hasAssignments),
    getCount(sql, filters, hasAssignments),
  ]);

  return (
    <AppShell title="Warm leads" subtitle="Pipeline odpowiedzi: kto odpisał, z jakiej kampanii, czy ktoś już przejął temat i co wymaga follow-upu.">
      {!hasAssignments ? (
        <Card style={{ marginBottom: 16, borderColor: '#7c2d12' }}>
          <div style={{ color: '#fdba74', fontWeight: 700, marginBottom: 6 }}>Fallback mode</div>
          <div style={{ color: '#cbd5e1', fontSize: 14 }}>
            Ta baza produkcyjna nie ma jeszcze tabel <code>lead_assignments</code>/<code>workers</code>, więc pokazuję bezpieczny widok warm leads bez ownerów i SLA zamiast wywalać stronę.
          </div>
        </Card>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="All warm leads" value={summary?.total ?? 0} />
        <StatCard label="Unassigned" value={summary?.unassigned ?? 0} tone={(summary?.unassigned ?? 0) > 0 ? 'danger' : 'default'} helper="brak przypisanego ownera" />
        <StatCard label="Assigned" value={summary?.assigned ?? 0} tone="warn" helper="przypisane, ale jeszcze nie ruszone" />
        <StatCard label="In progress" value={summary?.in_progress ?? 0} tone="success" helper="aktywnie prowadzone" />
        <StatCard label="Done" value={summary?.done ?? 0} helper="domknięte handoffy" />
      </section>

      <FilterForm>
        <FiltersGrid>
          <Field label="Campaign">
            <input name="campaign" defaultValue={filters.campaign} placeholder="np. evergreen" style={inputStyle} />
          </Field>
          <Field label="Pipeline stage">
            <select name="handoff" defaultValue={filters.handoff} style={inputStyle}>
              <option value="all">all</option>
              <option value="unassigned">unassigned</option>
              <option value="assigned" disabled={!hasAssignments}>assigned</option>
              <option value="in_progress" disabled={!hasAssignments}>in_progress</option>
              <option value="done" disabled={!hasAssignments}>done</option>
            </select>
          </Field>
          <Field label="Period">
            <select name="period" defaultValue={filters.period} style={inputStyle}>
              <option value="all">all</option>
              <option value="today">today</option>
              <option value="7d">last 7 days</option>
              <option value="30d">last 30 days</option>
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
              <th style={th}>replied_at</th>
              <th style={th}>pipeline</th>
              <th style={th}>campaign</th>
              <th style={th}>company</th>
              <th style={th}>contact</th>
              <th style={th}>owner</th>
              <th style={th}>sla_due_at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.lead_id}-${r.campaign_id || 'none'}-${i}`}>
                <td style={td}>{formatDateTime(r.replied_at)}</td>
                <td style={{ ...td, fontWeight: 700, color: r.pipeline_stage === 'unassigned' ? '#fca5a5' : r.pipeline_stage === 'in_progress' ? '#86efac' : '#fdba74' }}>{r.pipeline_stage}</td>
                <td style={td}>{r.campaign_id ? <Link href={`/campaigns/${r.campaign_id}`}>{r.campaign_name || r.campaign_id}</Link> : '-'}</td>
                <td style={td}>{r.company_name || '-'}</td>
                <td style={td}>
                  <div>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '-'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{r.email || '-'}</div>
                </td>
                <td style={td}>{r.owner || '-'}</td>
                <td style={td}>{formatDateTime(r.sla_due_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={td} colSpan={7}>No warm leads for current filters</td></tr>}
          </tbody>
        </Table>

        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={countRow?.total ?? 0} baseParams={{ campaign: filters.campaign, handoff: filters.handoff, period: filters.period }} />
      </Card>
    </AppShell>
  );
}
