import { AppShell, Card, StatCard, Table, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import AutoSyncControlPanel from '@/app/components/AutoSyncControlPanel.jsx';
import EmailSendingControlPanel from '@/app/components/EmailSendingControlPanel.jsx';
import EvergreenControlPanel from '@/app/components/EvergreenControlPanel.jsx';
import { getCampaignRuntimeState, getCampaignSendStats } from '@/lib/campaign-guard.js';

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
      <AppShell title="Evergreen sync monitor" subtitle="Nie znaleziono glownej kampanii evergreen w tabeli campaigns.">
        <Card>Brak kampanii <b>{CAMPAIGN_NAME}</b> w tabeli campaigns.</Card>
      </AppShell>
    );
  }

  const settings = campaign.settings || {};
  const runtime = getCampaignRuntimeState(settings);
  const sendStats = await getCampaignSendStats(sql, campaign.id);
  const lastSchedulerResult = runtime.last_scheduler_result || {};

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
    with latest_attempt as (
      select distinct on (ma.lead_id, ma.lead_contact_id)
        ma.lead_id,
        ma.lead_contact_id,
        ma.to_email
      from public.message_attempts ma
      order by ma.lead_id, ma.lead_contact_id, ma.created_at desc
    )
    select
      cl.id,
      cl.entered_at,
      cl.updated_at,
      cl.state::text as state,
      cl.contact_attempt_no,
      cl.next_run_at,
      l.company_name,
      coalesce(la.to_email::text, lc.email::text) as email,
      lc.first_name,
      lc.last_name
    from public.campaign_leads cl
    join public.leads l on l.id = cl.lead_id
    left join public.lead_contacts lc on lc.id = cl.active_contact_id
    left join latest_attempt la
      on la.lead_id = cl.lead_id
     and la.lead_contact_id = cl.active_contact_id
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
    <AppShell title="Evergreen sync monitor" subtitle="Monitor kampanii evergreen: sync leadow, status automatycznej wysylki maili, kolejka due i reczne akcje w jednym miejscu.">
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Campaign status" value={campaign.status} tone={campaign.status === 'running' ? 'success' : 'warn'} />
        <StatCard label="Lead sync" value={runtime.auto_sync_enabled ? 'enabled' : 'disabled'} tone={runtime.auto_sync_enabled ? 'success' : 'warn'} />
        <StatCard label="Email sending" value={runtime.auto_send_enabled ? 'enabled' : 'disabled'} tone={runtime.auto_send_enabled ? 'success' : 'warn'} />
        <StatCard label="Queued to send now" value={sendStats?.queued_now ?? 0} tone={(sendStats?.queued_now ?? 0) > 0 ? 'success' : 'default'} />
        <StatCard label="Sent last scheduler run" value={lastSchedulerResult?.sent ?? 0} />
        <StatCard label="Failed last scheduler run" value={lastSchedulerResult?.failed ?? 0} tone={(lastSchedulerResult?.failed ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Missing to sync" value={kpi?.missing_in_campaign_leads ?? 0} tone={(kpi?.missing_in_campaign_leads ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Updated 24h" value={kpi?.updated_last_24h ?? 0} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Campaign context</h2>
          <Table>
            <tbody>
              <tr><td style={td}>Campaign</td><td style={td}>{campaign.name}</td></tr>
              <tr><td style={td}>Campaign ID</td><td style={td}>{campaign.id}</td></tr>
              <tr><td style={td}>Status</td><td style={td}>{campaign.status}</td></tr>
              <tr><td style={td}>Updated</td><td style={td}>{String(campaign.updated_at)}</td></tr>
              <tr><td style={td}>Last sync</td><td style={td}>{runtime.last_sync_at || '-'}</td></tr>
              <tr><td style={td}>Next expected run</td><td style={td}>{settings.next_expected_run_at || '-'}</td></tr>
              <tr><td style={td}>Last auto-send</td><td style={td}>{runtime.last_auto_send_at || '-'}</td></tr>
              <tr><td style={td}>Next due email</td><td style={td}>{sendStats?.next_due_email ? `${sendStats.next_due_email.to_email} | attempt ${sendStats.next_due_email.contact_attempt_no ?? '-'} | ${sendStats.next_due_email.next_run_at ? String(sendStats.next_due_email.next_run_at) : 'now'}` : '-'}</td></tr>
            </tbody>
          </Table>
        </Card>

        <AutoSyncControlPanel
          campaignName={campaign.name}
          initial={{
            enabled: runtime.auto_sync_enabled,
            status: runtime.auto_sync_status || campaign.status || 'unknown',
            sync_interval_min: Number(runtime.sync_interval_min || 10),
            last_sync_at: runtime.last_sync_at || '',
            last_sync_result: settings.last_sync_result || null,
          }}
        />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <EmailSendingControlPanel
          campaignName={campaign.name}
          campaignId={campaign.id}
          initial={{
            enabled: runtime.auto_send_enabled,
            status: runtime.auto_send_status,
            queued_now: sendStats?.queued_now ?? 0,
            next_due_email: sendStats?.next_due_email || null,
            last_auto_send_at: runtime.last_auto_send_at || '',
            last_scheduler_result: runtime.last_scheduler_result || null,
            last_manual_send_at: runtime.last_manual_send_at || '',
            last_manual_send_result: runtime.last_manual_send_result || null,
            last_test_send_at: runtime.last_test_send_at || '',
            last_test_send_result: runtime.last_test_send_result || null,
          }}
        />

        <EvergreenControlPanel />
      </section>

      <section style={{ marginBottom: 20 }}>
        <Card>
          Glowna konfiguracja kampanii evergreen jest teraz tylko w <b>Campaigns</b>, zeby nie bylo duplikatow i rozjazdu UI vs DB.
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
              {recent.map((row) => (
                <tr key={row.id}>
                  <td style={td}>{row.company_name || '-'}</td>
                  <td style={td}>{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || '-'}</td>
                  <td style={td}>{row.state}</td>
                  <td style={td}>{row.contact_attempt_no ?? '-'}</td>
                  <td style={td}>{row.next_run_at ? String(row.next_run_at) : '-'}</td>
                  <td style={td}>{String(row.entered_at)}</td>
                  <td style={td}>{String(row.updated_at)}</td>
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
              {missingSample.map((row) => (
                <tr key={`${row.lead_id}-${row.lead_contact_id}`}>
                  <td style={td}>{row.company_name || '-'}</td>
                  <td style={td}>{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || '-'}</td>
                </tr>
              ))}
              {missingSample.length === 0 && <tr><td style={td} colSpan={2}>Brak brakujacych rekordow</td></tr>}
            </tbody>
          </Table>
        </Card>
      </section>
    </AppShell>
  );
}
