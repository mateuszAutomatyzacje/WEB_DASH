import { sql } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let rows = [];
  try {
    rows = await sql`
      select snapshot_date, scope, metrics
      from report_snapshots
      order by snapshot_date desc
      limit 14
    `;
  } catch (e) {
    // Most common on first run before schema loaded.
    return (
      <main style={{ padding: 24 }}>
        <h1>LeadGuard Dashboard</h1>
        <p>Brak tabel / brak danych jeszcze. Najpierw wgraj schema do Postgresa.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12, borderRadius: 8 }}>
          {String(e?.message || e)}
        </pre>
        <p>Test DB: <code>/api/health</code></p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>LeadGuard Dashboard</h1>
      <p style={{ color: '#444' }}>Ostatnie snapshoty (report_snapshots). MVP.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' }}>date</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' }}>scope</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' }}>metrics (json)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.snapshot_date}-${r.scope}`}>
              <td style={{ borderBottom: '1px solid #f0f0f0', padding: '8px 6px' }}>{String(r.snapshot_date)}</td>
              <td style={{ borderBottom: '1px solid #f0f0f0', padding: '8px 6px' }}>{String(r.scope)}</td>
              <td style={{ borderBottom: '1px solid #f0f0f0', padding: '8px 6px' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.metrics, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
