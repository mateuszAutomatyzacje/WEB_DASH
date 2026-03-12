import { Card } from '@/app/components/AppShell.jsx';

export default function LineChartCard({ title, subtitle, series = [] }) {
  const width = 760;
  const height = 240;
  const pad = 28;
  const maxY = Math.max(1, ...series.flatMap((d) => [Number(d.sent || 0), Number(d.replied || 0)]));
  const stepX = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  const y = (v) => height - pad - (Number(v || 0) / maxY) * (height - pad * 2);
  const x = (i) => pad + i * stepX;
  const path = (key) => series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d[key])}`).join(' ');

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
        {subtitle ? <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 13 }}>{subtitle}</div> : null}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 240, display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const yy = pad + (height - pad * 2) * p;
          return <line key={p} x1={pad} y1={yy} x2={width - pad} y2={yy} stroke="#1f2937" strokeWidth="1" />;
        })}
        <path d={path('sent')} fill="none" stroke="#60a5fa" strokeWidth="3" />
        <path d={path('replied')} fill="none" stroke="#34d399" strokeWidth="3" />
        {series.map((d, i) => (
          <g key={d.day}>
            <circle cx={x(i)} cy={y(d.sent)} r="3" fill="#60a5fa" />
            <circle cx={x(i)} cy={y(d.replied)} r="3" fill="#34d399" />
            <text x={x(i)} y={height - 8} textAnchor="middle" fill="#94a3b8" fontSize="10">{String(d.day).slice(5)}</text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#cbd5e1' }}>
        <span><span style={{ color: '#60a5fa', fontWeight: 700 }}>■</span> Sent</span>
        <span><span style={{ color: '#34d399', fontWeight: 700 }}>■</span> Replies</span>
      </div>
    </Card>
  );
}
