import Link from 'next/link';

const navLink = {
  color: '#f8fafc',
  textDecoration: 'none',
  padding: '8px 12px',
  borderRadius: 10,
  background: '#111827',
  border: '1px solid #374151',
  fontSize: 14,
};

export function AppShell({ title, subtitle, children, actions }) {
  return (
    <main style={{ padding: 24, background: '#020617', minHeight: '100vh', color: '#f8fafc' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>
                LeadGuard / WEB_DASH
              </div>
              <h1 style={{ margin: 0, fontSize: 34, color: '#ffffff' }}>{title}</h1>
              {subtitle ? <p style={{ margin: '8px 0 0', color: '#cbd5e1', maxWidth: 900 }}>{subtitle}</p> : null}
            </div>
            {actions ? <div>{actions}</div> : null}
          </div>
        </header>

        <nav style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
          <Link href="/" style={navLink}>Dashboard</Link>
          <Link href="/campaigns" style={navLink}>Campaigns</Link>
          <Link href="/leads" style={navLink}>Leads</Link>
          <Link href="/warm-leads" style={navLink}>Warm leads</Link>
          <Link href="/queue" style={navLink}>Queue</Link>
          <Link href="/workers" style={navLink}>Operations</Link>
          <Link href="/evergreen-sync" style={navLink}>Evergreen</Link>
          <Link href="/logs" style={navLink}>Logs</Link>
          <a href="/api/health" style={navLink}>API health</a>
        </nav>

        {children}
      </div>
    </main>
  );
}

export function Card({ children, style }) {
  return (
    <section style={{ background: '#000000', border: '1px solid #1f2937', borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.3)', color: '#f8fafc', ...style }}>
      {children}
    </section>
  );
}

export function StatCard({ label, value, helper, tone = 'default' }) {
  const tones = {
    default: { bg: '#111827', fg: '#93c5fd' },
    success: { bg: '#052e16', fg: '#86efac' },
    warn: { bg: '#451a03', fg: '#fdba74' },
    danger: { bg: '#450a0a', fg: '#fca5a5' },
  };
  const current = tones[tone] || tones.default;
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#ffffff' }}>{value ?? 0}</div>
          {helper ? <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>{helper}</div> : null}
        </div>
        <div style={{ minWidth: 14, minHeight: 14, borderRadius: 999, background: current.bg, color: current.fg, padding: '4px 8px', fontSize: 11, fontWeight: 700 }}>
          {tone}
        </div>
      </div>
    </Card>
  );
}

export function FilterForm({ children }) {
  return (
    <form method="get" style={{ display: 'grid', gap: 12, background: '#000000', border: '1px solid #1f2937', borderRadius: 16, padding: 16, marginBottom: 18, color: '#f8fafc' }}>
      {children}
    </form>
  );
}

export function FiltersGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>;
}

export function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#cbd5e1' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle = {
  width: '100%',
  border: '1px solid #374151',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  background: '#111827',
  color: '#f8fafc',
};

export function Table({ children }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>{children}</table>;
}

export const th = { textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '10px 8px', color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 };
export const td = { borderBottom: '1px solid #111827', padding: '10px 8px', verticalAlign: 'top', color: '#f8fafc' };

export function Pagination({ page, pageSize, total, baseParams = {} }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const paramsFor = (targetPage) => {
    const p = new URLSearchParams();
    Object.entries({ ...baseParams, page: String(targetPage) }).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== '') p.set(k, String(v));
    });
    return `?${p.toString()}`;
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 13, color: '#94a3b8' }}>
        Page {page} / {totalPages} · total rows: {total}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href={paramsFor(Math.max(1, page - 1))} style={navLink}>← Prev</Link>
        <Link href={paramsFor(Math.min(totalPages, page + 1))} style={navLink}>Next →</Link>
      </div>
    </div>
  );
}
