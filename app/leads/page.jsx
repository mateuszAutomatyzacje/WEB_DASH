import { AppShell, Card, FilterForm, FiltersGrid, Field, Pagination, Table, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = ['all', 'new', 'enriched', 'email_built', 'queued', 'in_campaign', 'stopped', 'handed_off', 'closed', 'invalid'];

function normalize(searchParams) {
  const query = String(searchParams?.q || '').trim();
  const status = String(searchParams?.status || 'all');
  const emailState = String(searchParams?.email || 'all');
  const enriched = String(searchParams?.enriched || 'all');
  const pageRaw = Number(searchParams?.page || 1);
  return {
    query,
    status: STATUS_OPTIONS.includes(status) ? status : 'all',
    emailState: ['all', 'with_email', 'without_email'].includes(emailState) ? emailState : 'all',
    enriched: ['all', 'yes', 'no'].includes(enriched) ? enriched : 'all',
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
  };
}

export default async function LeadsPage({ searchParams }) {
  const sql = getSql();
  const filters = normalize(searchParams);
  const offset = (filters.page - 1) * PAGE_SIZE;

  const queryFilter = filters.query ? `%${filters.query}%` : null;
  const statusFilter = filters.status === 'all' ? null : filters.status;

  const rows = await sql`
    with base as (
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
      where (${statusFilter}::text is null or l.status::text = ${statusFilter})
        and (
          ${queryFilter}::text is null
          or coalesce(l.company_name, '') ilike ${queryFilter}
          or coalesce(l.domain, '') ilike ${queryFilter}
          or coalesce(l.website_url, '') ilike ${queryFilter}
        )
      group by l.id
    )
    select *
    from base
    where (
      ${filters.emailState} = 'all'
      or (${filters.emailState} = 'with_email' and contacts_with_email > 0)
      or (${filters.emailState} = 'without_email' and contacts_with_email = 0)
    )
      and (
        ${filters.enriched} = 'all'
        or (${filters.enriched} = 'yes' and enriched_contacts > 0)
        or (${filters.enriched} = 'no' and enriched_contacts = 0)
      )
    order by updated_at desc
    limit ${PAGE_SIZE} offset ${offset}
  `;

  const [countRow] = await sql`
    with base as (
      select
        l.id as lead_id,
        count(lc.id) filter (where lc.email is not null)::int as contacts_with_email,
        count(distinct lce.lead_contact_id)::int as enriched_contacts
      from public.leads l
      left join public.lead_contacts lc on lc.lead_id = l.id
      left join public.lead_contact_enrichments lce on lce.lead_contact_id = lc.id and coalesce(lce.ok, true) = true
      where (${statusFilter}::text is null or l.status::text = ${statusFilter})
        and (
          ${queryFilter}::text is null
          or coalesce(l.company_name, '') ilike ${queryFilter}
          or coalesce(l.domain, '') ilike ${queryFilter}
          or coalesce(l.website_url, '') ilike ${queryFilter}
        )
      group by l.id
    )
    select count(*)::int as total
    from base
    where (
      ${filters.emailState} = 'all'
      or (${filters.emailState} = 'with_email' and contacts_with_email > 0)
      or (${filters.emailState} = 'without_email' and contacts_with_email = 0)
    )
      and (
        ${filters.enriched} = 'all'
        or (${filters.enriched} = 'yes' and enriched_contacts > 0)
        or (${filters.enriched} = 'no' and enriched_contacts = 0)
      )
  `;

  return (
    <AppShell title="Leads" subtitle="Lista firm z wyszukiwaniem i filtrami po statusie, emailu i enrichment — szybciej znajdziesz to, co wymaga działania.">
      <FilterForm>
        <FiltersGrid>
          <Field label="Search company / domain">
            <input name="q" defaultValue={filters.query} placeholder="np. medyczna, example.com" style={inputStyle} />
          </Field>
          <Field label="Lead status">
            <select name="status" defaultValue={filters.status} style={inputStyle}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Email coverage">
            <select name="email" defaultValue={filters.emailState} style={inputStyle}>
              <option value="all">all</option>
              <option value="with_email">with email</option>
              <option value="without_email">without email</option>
            </select>
          </Field>
          <Field label="Enriched contacts">
            <select name="enriched" defaultValue={filters.enriched} style={inputStyle}>
              <option value="all">all</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
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
            {rows.length === 0 && <tr><td style={td} colSpan={7}>No leads for current filters</td></tr>}
          </tbody>
        </Table>

        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={countRow?.total ?? 0} baseParams={{ q: filters.query, status: filters.status, email: filters.emailState, enriched: filters.enriched }} />
      </Card>
    </AppShell>
  );
}
