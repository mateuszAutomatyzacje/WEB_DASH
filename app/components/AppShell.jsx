import Link from 'next/link';

const navLink = {
  color: '#1f2937',
  textDecoration: 'none',
  padding: '8px 12px',
  borderRadius: 10,
  background: '#fff',
  border: '1px solid #e5e7eb',
  fontSize: 14,
};

export function AppShell({ title, subtitle, children, actions }) {
  return (
    <main style={{ padding: 24, background: '#f8fafc', minHeight: '100vh', color: '#111827' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>
                LeadGuard / WEB_DASH
              </div>
              <h1 style={{ margin: 0, fontSize: 34 }}>{title}</h1>
              {subtitle ? <p style={{ margin: '8px 0 0', color: '#475569', maxWidth: 900 }}>{subtitle}</p> : null}
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
          <a href="/api/health" style={navLink}>API health</a>
        </nav>

        {children}
      </div>
    </main>
  );
}

export function Card({ children, style }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', ...style }}>
      {children}
    </section>
  );
}

export function StatCard({ label, value, helper, tone = 'default' }) {
  const tones = {
    default: { bg: '#eff6ff', fg: '#1d4ed8' },
    success: { bg: '#ecfdf5', fg: '#047857' },
    warn: { bg: '#fffbeb', fg: '#b45309' },
    danger: { bg: '#fef2f2', fg: '#b91c1c' },
  };
  const current = tones[tone] || tones.default;
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}>{value ?? 0}</div>
          {helper ? <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>{helper}</div> : null}
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
    <form method="get" style={{ display: 'grid', gap: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, marginBottom: 18 }}>
      {children}
    </form>
  );
}

export function FiltersGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>;
}

export function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#475569' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  background: '#fff',
};

export function Table({ children }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>{children}</table>;
}

export const th = { textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '10px 8px', color: '#475569', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 };
export const td = { borderBottom: '1px solid #f1f5f9', padding: '10px 8px', verticalAlign: 'top' };

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
      <div style={{ fontSize: 13, color: '#64748b' }}>
        Page {page} / {totalPages} · total rows: {total}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href={paramsFor(Math.max(1, page - 1))} style={navLink}>← Prev</Link>
        <Link href={paramsFor(Math.min(totalPages, page + 1))} style={navLink}>Next →</Link>
      </div>
    </div>
  );
}
