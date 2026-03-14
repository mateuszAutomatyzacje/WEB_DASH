import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import EvergreenControlPanel from '@/app/components/EvergreenControlPanel.jsx';
import AutoSyncControlPanel from '@/app/components/AutoSyncControlPanel.jsx';

export const dynamic = 'force-dynamic';

const CAMPAIGN_NAME = 'OUTSOURCING_IT_EVERGREEM';

export default async function EvergreenSyncPage() {
  const sql = getSql();

  const campaignRows = await sql`
    select id, name, status::text as status, description, settings, created_at, updated_at
    from public.campaigns
    where name = ${CAMPAIGN_NAME}
    order by created_at desc
    limit 1
  `;

  const campaign = campaignRows[0] || null;

  if (!campaign) {
    return (
      <AppShell title="Evergreen sync monitor" subtitle="Nie znaleziono głównej kampanii evergreen w tabeli campaigns.">
        <Card>Brak kampanii <b>{CAMPAIGN_NAME}</b> w tabeli campaigns.</Card>
      </AppShell>
    );
  }

  const settings = campaign.settings || {};

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
    <AppShell title="Evergreen sync monitor" subtitle="Monitor synchronizacji evergreen: kliknij Start Auto Sync, zobacz status running i miej pod ręką ręczne akcje oraz KPI syncu.">
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Campaign status" value={campaign.status} tone={campaign.status === 'running' ? 'success' : 'warn'} />
        <StatCard label="Auto sync" value={settings.auto_sync_enabled ? 'enabled' : 'disabled'} tone={settings.auto_sync_enabled ? 'success' : 'warn'} />
        <StatCard label="Sync status" value={settings.auto_sync_status || 'unknown'} tone={settings.auto_sync_status === 'running' ? 'success' : settings.auto_sync_status === 'error' ? 'danger' : 'warn'} />
        <StatCard label="Missing to sync" value={kpi?.missing_in_campaign_leads ?? 0} tone={(kpi?.missing_in_campaign_leads ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Inserted 24h" value={kpi?.inserted_last_24h ?? 0} />
        <StatCard label="Updated 24h" value={kpi?.updated_last_24h ?? 0} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Campaign context</h2>
          <Table>
            <tbody>
              <tr><td style={td}>Campaign</td><td style={td}>{campaign.name}</td></tr>
              <tr><td style={td}>Campaign ID</td><td style={td}>{campaign.id}</td></tr>
              <tr><td style={td}>Status</td><td style={td}>{campaign.status}</td></tr>
              <tr><td style={td}>Updated</td><td style={td}>{String(campaign.updated_at)}</td></tr>
              <tr><td style={td}>Last sync</td><td style={td}>{settings.last_sync_at || '-'}</td></tr>
              <tr><td style={td}>Next expected run</td><td style={td}>{settings.next_expected_run_at || '-'}</td></tr>
            </tbody>
          </Table>
        </Card>

        <AutoSyncControlPanel
          campaignName={campaign.name}
          initial={{
            enabled: Boolean(settings.auto_sync_enabled),
            status: settings.auto_sync_status || campaign.status || 'unknown',
            sync_interval_min: Number(settings.sync_interval_min || 10),
            last_sync_at: settings.last_sync_at || '',
            last_sync_result: settings.last_sync_result || null,
          }}
        />

        <EvergreenControlPanel />
      </section>

      <section style={{ marginBottom: 20 }}>
        <Card>
          Główna konfiguracja kampanii evergreen jest teraz tylko w <b>Campaigns</b>, żeby nie było duplikatów i rozjazdu UI vs DB.
        </Card>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Recent records in campaign_leads</h2>
          <Table>
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
          </Table>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Missing in campaign_leads</h2>
          <Table>
            <thead>
              <tr>
                <th style={th}>company</th>
                <th style={th}>contact/email</th>
              </tr>
            </thead>
            <tbody>
              {missingSample.map((r) => (
                <tr key={`${r.lead_id}-${r.lead_contact_id}`}>
                  <td style={td}>{r.company_name || '-'}</td>
                  <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '-'}</td>
                </tr>
              ))}
              {missingSample.length === 0 && <tr><td style={td} colSpan={2}>Brak brakujących rekordów</td></tr>}
            </tbody>
          </Table>
        </Card>
      </section>
    </AppShell>
  );
}
