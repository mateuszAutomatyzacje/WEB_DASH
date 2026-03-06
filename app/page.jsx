import Link from 'next/link';
// GuardPollerTest removed from overview
import { getSql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

const td = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' };

function Nav() {
  return (
    <nav style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
      <Link href="/">Overview</Link>
      <Link href="/campaigns">Campaigns</Link>
      <Link href="/leads">Leads</Link>
      <Link href="/queue">Queue</Link>
      <Link href="/workers">Workers</Link>
      <Link href="/warm-leads">Warm leads</Link>
      <Link href="/evergreen-sync">Evergreen sync</Link>
      <a href="/api/health">/api/health</a>
    </nav>
  );
}

async function getOverviewData() {
  const sql = getSql();

  const [counts] = await sql`
    select
      (select count(*)::int from public.leads) as leads_total,
      (select count(*)::int from public.campaigns) as campaigns_total,
      (select count(*)::int from public.campaign_leads) as campaign_leads_total,
      (
        select count(distinct lce.lead_contact_id)::int
        from public.lead_contact_enrichments lce
        where coalesce(lce.ok, true) = true
      ) as enriched_contacts_total,
      (
        select count(*)::int
        from public.lead_contacts lc
        where lc.status in ('enriched', 'in_campaign', 'closed')
      ) as lead_contacts_progressed_total,
      (select count(*)::int from public.message_attempts) as message_attempts_total
  `;

  return counts || {};
}

export default async function Page() {
  try {
    const totals = await getOverviewData();

    return (
      <main style={{ padding: 24 }}>
        <h1>LeadGuard Dashboard</h1>
        <Nav />

        <h2>KPIs (live z bazy)</h2>
        <p style={{ fontSize: 12, color: '#555', marginBottom: 14 }}>
          Dane liczone live z aktualnej bazy. Odśwież stronę, żeby pobrać najnowsze wartości.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 22 }}>
          <tbody>
            {[
              ['Leads total', totals.leads_total],
              ['Enriched contacts total', totals.enriched_contacts_total],
              ['Lead contacts progressed', totals.lead_contacts_progressed_total],
              ['Campaigns total', totals.campaigns_total],
              ['Campaign leads total', totals.campaign_leads_total],
              ['Message attempts total', totals.message_attempts_total],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={td}>{k}</td>
                <td style={td}>{v ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    );
  } catch (e) {
    return (
      <main style={{ padding: 24 }}>
        <h1>LeadGuard Dashboard</h1>
        <Nav />
        <p>Brak tabel / brak danych jeszcze. Najpierw wgraj schema do Postgresa.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12, borderRadius: 8 }}>
          {String(e?.message || e)}
        </pre>
      </main>
    );
  }
}
