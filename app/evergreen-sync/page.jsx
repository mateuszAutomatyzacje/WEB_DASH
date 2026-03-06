import Link from 'next/link';
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px', verticalAlign: 'top' };
const th = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' };

const CAMPAIGN_NAME = 'OUTSOURCING_IT_EVERGREEM';

export default async function EvergreenSyncPage() {
  const sql = getSql();

  const campaignRows = await sql`
    select id, name, status::text as status, created_at, updated_at
    from public.campaigns
    where name = ${CAMPAIGN_NAME}
    order by created_at desc
    limit 1
  `;

  const campaign = campaignRows[0] || null;

  if (!campaign) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Evergreen sync monitor</h1>
        <p><Link href="/">← Overview</Link></p>
        <p>Brak kampanii <b>{CAMPAIGN_NAME}</b> w tabeli campaigns.</p>
      </main>
    );
  }

  const [kpi] = await sql`
    with src as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      where ma.lead_id is not null
        and ma.lead_contact_id is not null
    ), cl as (
      select cl.lead_id, cl.active_contact_id
      from public.campaign_leads cl
      where cl.campaign_id = ${campaign.id}::uuid
    )
    select
      (select count(*)::int from src) as source_pairs_total,
      (select count(*)::int from cl) as evergreen_pairs_total,
      (
        select count(*)::int
        from src s
        left join cl on cl.lead_id = s.lead_id and cl.active_contact_id = s.lead_contact_id
        where cl.lead_id is null
      ) as missing_in_campaign_leads,
      (
        select count(*)::int
        from public.campaign_leads x
        where x.campaign_id = ${campaign.id}::uuid
          and x.entered_at >= now() - interval '24 hours'
      ) as inserted_last_24h,
      (
        select count(*)::int
        from public.campaign_leads x
        where x.campaign_id = ${campaign.id}::uuid
          and x.updated_at >= now() - interval '24 hours'
      ) as updated_last_24h
  `;

  const recent = await sql`
    select
      cl.id,
      cl.entered_at,
      cl.updated_at,
      cl.state::text as state,
      cl.contact_attempt_no,
      cl.next_run_at,
      l.company_name,
      lc.email,
      lc.first_name,
      lc.last_name
    from public.campaign_leads cl
    join public.leads l on l.id = cl.lead_id
    left join public.lead_contacts lc on lc.id = cl.active_contact_id
    where cl.campaign_id = ${campaign.id}::uuid
    order by greatest(cl.updated_at, cl.entered_at) desc
    limit 200
  `;

  const missingSample = await sql`
    with src as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      where ma.lead_id is not null
        and ma.lead_contact_id is not null
    )
    select
      l.company_name,
      lc.email,
      lc.first_name,
      lc.last_name,
      s.lead_id,
      s.lead_contact_id
    from src s
    join public.leads l on l.id = s.lead_id
    left join public.lead_contacts lc on lc.id = s.lead_contact_id
    left join public.campaign_leads cl
      on cl.campaign_id = ${campaign.id}::uuid
     and cl.lead_id = s.lead_id
     and cl.active_contact_id = s.lead_contact_id
    where cl.id is null
    order by l.company_name asc
    limit 100
  `;

  return (
    <main style={{ padding: 24 }}>
      <h1>Evergreen sync monitor</h1>
      <p style={{ marginBottom: 14 }}>
        <Link href="/">← Overview</Link>
      </p>

      <div style={{ marginBottom: 18, fontSize: 14 }}>
        <div><b>Campaign:</b> {campaign.name}</div>
        <div><b>Campaign ID:</b> {campaign.id}</div>
        <div><b>Status:</b> {campaign.status}</div>
        <div><b>Updated:</b> {String(campaign.updated_at)}</div>
      </div>

      <h2>Sync KPIs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 22 }}>
        <tbody>
          {[
            ['Źródło (distinct lead+contact z message_attempts)', kpi?.source_pairs_total ?? 0],
            ['Jest już w campaign_leads (evergreen)', kpi?.evergreen_pairs_total ?? 0],
            ['Brakuje do dopisania', kpi?.missing_in_campaign_leads ?? 0],
            ['Inserted w ostatnich 24h', kpi?.inserted_last_24h ?? 0],
            ['Updated w ostatnich 24h', kpi?.updated_last_24h ?? 0],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={td}>{k}</td>
              <td style={td}><b>{v}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Ostatnie rekordy w campaign_leads (max 200)</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={th}>company</th>
            <th style={th}>contact/email</th>
            <th style={th}>state</th>
            <th style={th}>attempt</th>
            <th style={th}>next_run_at</th>
            <th style={th}>entered_at</th>
            <th style={th}>updated_at</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '-'}</td>
              <td style={td}>{r.state}</td>
              <td style={td}>{r.contact_attempt_no ?? '-'}</td>
              <td style={td}>{r.next_run_at ? String(r.next_run_at) : '-'}</td>
              <td style={td}>{String(r.entered_at)}</td>
              <td style={td}>{String(r.updated_at)}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td style={td} colSpan={7}>Brak danych</td></tr>}
        </tbody>
      </table>

      <h2>Brakuje w campaign_leads (sample max 100)</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>company</th>
            <th style={th}>contact/email</th>
            <th style={th}>lead_id</th>
            <th style={th}>lead_contact_id</th>
          </tr>
        </thead>
        <tbody>
          {missingSample.map((r) => (
            <tr key={`${r.lead_id}-${r.lead_contact_id}`}>
              <td style={td}>{r.company_name || '-'}</td>
              <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '-'}</td>
              <td style={td}>{r.lead_id}</td>
              <td style={td}>{r.lead_contact_id}</td>
            </tr>
          ))}
          {missingSample.length === 0 && <tr><td style={td} colSpan={4}>Brak brakujących rekordów</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
