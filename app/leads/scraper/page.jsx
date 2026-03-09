import Link from 'next/link';
import { getSql } from '@/lib/db.js';
import ScrapeSettingsPanel from '@/app/components/ScrapeSettingsPanel.jsx';

export const dynamic = 'force-dynamic';

export default async function LeadsScraperPage() {
  const sql = getSql();

  const rows = await sql`
    select
      id,
      running,
      base_url,
      max_pages,
      budget_max_requests,
      crawl4ai_endpoint,
      rate_seconds,
      job_title,
      city,
      experience_level,
      test_mode,
      apollo_max_people_per_company,
      last_run_id,
      last_run_status,
      last_run_at,
      locked_until,
      updated_at
    from public.scrape_settings
    where id = 'global'
    limit 1
  `;

  const cfg = rows?.[0] || null;

  return (
    <main style={{ padding: 24 }}>
      <h1>Leads → Scraper (JustJoin → enrichment)</h1>
      <p style={{ marginBottom: 14 }}>
        <Link href="/leads">← Leads</Link>
        {' · '}
        <Link href="/">Overview</Link>
      </p>

      {!cfg ? (
        <div style={{ padding: 12, border: '1px solid #f0c', borderRadius: 8 }}>
          Brak rekordu <code>scrape_settings.id='global'</code> w DB.
        </div>
      ) : (
        <>
          <ScrapeSettingsPanel initial={cfg} />
          <h3>DB snapshot (read-only)</h3>
          <pre style={{ marginTop: 10, background: '#111', color: '#eee', padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
            {JSON.stringify(cfg, null, 2)}
          </pre>
        </>
      )}
    </main>
  );
}
