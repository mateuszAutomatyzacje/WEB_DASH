import Link from 'next/link';
import CampaignConfigPanel from '@/app/components/CampaignConfigPanel.jsx';
import AdminButton from '@/app/components/AdminButton.jsx';
import { AppShell, Card, FilterForm, FiltersGrid, Field, Pagination, Table, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = ['all', 'draft', 'ready', 'running', 'paused', 'stopped', 'archived'];
const PAGE_SIZE = 25;

function normalizeSearchParams(searchParams) {
  const query = String(searchParams?.q || '').trim();
  const status = String(searchParams?.status || 'all');
  const risk = String(searchParams?.risk || 'all');
  const pageRaw = Number(searchParams?.page || 1);
  return {
    query,
    status: STATUS_OPTIONS.includes(status) ? status : 'all',
    risk: ['all', 'green', 'yellow', 'red'].includes(risk) ? risk : 'all',
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
  };
}

export default async function CampaignsPage({ searchParams }) {
  const sql = getSql();
  const resolvedSearchParams = await searchParams;
  const filters = normalizeSearchParams(resolvedSearchParams);
  const offset = (filters.page - 1) * PAGE_SIZE;

  const initialCampaignRows = await sql`
    select id, name
    from public.campaigns
    where name = ${DEFAULT_EVERGREEN_NAME}
    order by created_at desc
    limit 1
  `;
  const initialCampaign = initialCampaignRows[0] || null;

  const statusFilter = filters.status === 'all' ? null : filters.status;
  const queryFilter = filters.query ? `%${filters.query}%` : null;
  const riskFilter = filters.risk === 'all' ? null : filters.risk;

  const rows = await sql`
    with latest_event as (
      select distinct on (ma.campaign_id, ma.lead_id, ma.lead_contact_id)
        ma.campaign_id,
        ma.lead_id,
        ma.lead_contact_id,
        me.event_type::text as event_type
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where ma.campaign_id is not null
      order by ma.campaign_id, ma.lead_id, ma.lead_contact_id, me.created_at desc
    ), monitor as (
      select
        cl.campaign_id,
        cl.id as campaign_lead_id,
        case
          when cl.stop_reason::text = 'replied' or le.event_type = 'replied' then 'green'
          when coalesce(le.event_type, '') in ('bounced','complained','unsubscribed','failed') then 'red'
          when cl.contact_attempt_no >= 4 then 'red'
          else 'yellow'
        end as monitor_status
      from public.campaign_leads cl
      left join latest_event le
        on le.campaign_id = cl.campaign_id
       and le.lead_id = cl.lead_id
       and le.lead_contact_id = cl.active_contact_id
    ), campaign_stats as (
      select
        c.id,
        c.name,
        c.status::text as status,
        c.created_at,
        count(cl.id)::int as leads_total,
        count(cl.id) filter (where cl.state = 'in_campaign')::int as active_in_queue,
        count(cl.id) filter (where cl.stop_reason = 'replied')::int as replied,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'green')::int as green,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'yellow')::int as yellow,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'red')::int as red
      from public.campaigns c
      left join public.campaign_leads cl on cl.campaign_id = c.id
      left join monitor m on m.campaign_lead_id = cl.id
      where (${statusFilter}::text is null or c.status::text = ${statusFilter})
        and (${queryFilter}::text is null or c.name ilike ${queryFilter})
      group by c.id
    )
    select *
    from campaign_stats
    where (
      ${riskFilter}::text is null
      or (${riskFilter} = 'red' and red > 0)
      or (${riskFilter} = 'yellow' and red = 0 and yellow > 0)
      or (${riskFilter} = 'green' and green > 0 and red = 0 and yellow = 0)
    )
    order by red desc, yellow desc, replied desc, created_at desc
    limit ${PAGE_SIZE} offset ${offset}
  `;

  const [countRow] = await sql`
    with latest_event as (
      select distinct on (ma.campaign_id, ma.lead_id, ma.lead_contact_id)
        ma.campaign_id,
        ma.lead_id,
        ma.lead_contact_id,
        me.event_type::text as event_type
      from public.message_attempts ma
      join public.message_events me on me.message_attempt_id = ma.id
      where ma.campaign_id is not null
      order by ma.campaign_id, ma.lead_id, ma.lead_contact_id, me.created_at desc
    ), monitor as (
      select
        cl.campaign_id,
        cl.id as campaign_lead_id,
        case
          when cl.stop_reason::text = 'replied' or le.event_type = 'replied' then 'green'
          when coalesce(le.event_type, '') in ('bounced','complained','unsubscribed','failed') then 'red'
          when cl.contact_attempt_no >= 4 then 'red'
          else 'yellow'
        end as monitor_status
      from public.campaign_leads cl
      left join latest_event le
        on le.campaign_id = cl.campaign_id
       and le.lead_id = cl.lead_id
       and le.lead_contact_id = cl.active_contact_id
    ), campaign_stats as (
      select
        c.id,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'green')::int as green,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'yellow')::int as yellow,
        count(m.campaign_lead_id) filter (where m.monitor_status = 'red')::int as red
      from public.campaigns c
      left join public.campaign_leads cl on cl.campaign_id = c.id
      left join monitor m on m.campaign_lead_id = cl.id
      where (${statusFilter}::text is null or c.status::text = ${statusFilter})
        and (${queryFilter}::text is null or c.name ilike ${queryFilter})
      group by c.id
    )
    select count(*)::int as total
    from campaign_stats
    where (
      ${riskFilter}::text is null
      or (${riskFilter} = 'red' and red > 0)
      or (${riskFilter} = 'yellow' and red = 0 and yellow > 0)
      or (${riskFilter} = 'green' and green > 0 and red = 0 and yellow = 0)
    )
  `;

  return (
    <AppShell title="Campaigns" subtitle="Widok kampanii z filtrowaniem po statusie, ryzyku i wyszukiwaniem po nazwie — plus szybkie klonowanie kampanii.">
      <CampaignConfigPanel initialCampaignId={initialCampaign?.id || ''} initialCampaignName={initialCampaign?.name || DEFAULT_EVERGREEN_NAME} />

      <FilterForm>
        <FiltersGrid>
          <Field label="Search campaign name">
            <input name="q" defaultValue={filters.query} placeholder="np. outsourcing" style={inputStyle} />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={filters.status} style={inputStyle}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Risk bucket">
            <select name="risk" defaultValue={filters.risk} style={inputStyle}>
              <option value="all">all</option>
              <option value="red">red</option>
              <option value="yellow">yellow</option>
              <option value="green">green</option>
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
              <th style={th}>name</th>
              <th style={th}>status</th>
              <th style={th}>leads_total</th>
              <th style={th}>active_in_queue</th>
              <th style={th}>replied</th>
              <th style={th}>green</th>
              <th style={th}>yellow</th>
              <th style={th}>red</th>
              <th style={th}>actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}><Link href={`/campaigns/${r.id}`}>{r.name}</Link></td>
                <td style={td}>{r.status}</td>
                <td style={td}>{r.leads_total}</td>
                <td style={td}>{r.active_in_queue}</td>
                <td style={td}>{r.replied}</td>
                <td style={{ ...td, color: '#0a7d22', fontWeight: 700 }}>{r.green}</td>
                <td style={{ ...td, color: '#8a6d00', fontWeight: 700 }}>{r.yellow}</td>
                <td style={{ ...td, color: '#b00020', fontWeight: 700 }}>{r.red}</td>
                <td style={td}><AdminButton label="Clone Campaign" action="/api/admin/campaign/clone" body={{ campaign_id: r.id }} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={td} colSpan={9}>No campaigns for current filters</td></tr>}
          </tbody>
        </Table>

        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={countRow?.total ?? 0} baseParams={{ q: filters.query, status: filters.status, risk: filters.risk }} />
      </Card>
    </AppShell>
  );
}
