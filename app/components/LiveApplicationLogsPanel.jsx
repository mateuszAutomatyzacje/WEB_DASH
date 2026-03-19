'use client';

import { startTransition, useEffect, useState } from 'react';
import { Card, StatCard } from '@/app/components/AppShell.jsx';
import { formatDateTime } from '@/lib/time.js';

const LEVEL_STYLES = {
  info: { border: '#1d4ed8', badgeBg: '#0f172a', badgeFg: '#93c5fd' },
  success: { border: '#15803d', badgeBg: '#052e16', badgeFg: '#86efac' },
  warn: { border: '#b45309', badgeBg: '#451a03', badgeFg: '#fdba74' },
  warning: { border: '#b45309', badgeBg: '#451a03', badgeFg: '#fdba74' },
  error: { border: '#b91c1c', badgeBg: '#450a0a', badgeFg: '#fca5a5' },
};

function buildSummary(entries = []) {
  const summary = {
    total: entries.length,
    errors: 0,
    warnings: 0,
    delivery: 0,
    runtime: 0,
  };

  for (const entry of entries) {
    if (entry.kind === 'delivery') summary.delivery += 1;
    if (entry.kind === 'runtime') summary.runtime += 1;
    if (entry.level === 'error') summary.errors += 1;
    if (entry.level === 'warn' || entry.level === 'warning') summary.warnings += 1;
  }

  return summary;
}

function buildContextLine(entry) {
  const parts = [];
  if (entry.campaign_name) parts.push(`campaign: ${entry.campaign_name}`);
  if (entry.company_name) parts.push(`company: ${entry.company_name}`);
  if (entry.contact_name) parts.push(`contact: ${entry.contact_name}`);
  if (entry.target_email) parts.push(`target: ${entry.target_email}`);
  if (entry.sequence_step) parts.push(`step: ${entry.sequence_step}`);
  if (entry.provider) parts.push(`provider: ${entry.provider}`);
  return parts.join(' | ');
}

function buildDetailsLine(entry) {
  const parts = [];
  const details = entry.details || {};
  if (details.subject) parts.push(`subject: ${details.subject}`);
  if (typeof details.queued !== 'undefined') parts.push(`queued=${details.queued}`);
  if (typeof details.sent !== 'undefined') parts.push(`sent=${details.sent}`);
  if (typeof details.failed !== 'undefined') parts.push(`failed=${details.failed}`);
  if (typeof details.limit !== 'undefined') parts.push(`limit=${details.limit}`);
  if (details.interval_min) parts.push(`interval=${details.interval_min}m`);
  if (details.lead_sync_interval_min) parts.push(`sync=${details.lead_sync_interval_min}m`);
  if (details.send_email_interval_min) parts.push(`send=${details.send_email_interval_min}m`);
  if (details.next_run_at) parts.push(`next=${formatDateTime(details.next_run_at)}`);
  if (details.retry_at) parts.push(`retry=${formatDateTime(details.retry_at)}`);
  if (details.webhook_url) parts.push(`webhook=${details.webhook_url}`);
  return parts.join(' | ');
}

function getLevelStyle(level) {
  return LEVEL_STYLES[level] || LEVEL_STYLES.info;
}

export default function LiveApplicationLogsPanel({
  initialEntries = [],
  pollMs = 5000,
  limit = 160,
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(new Date().toISOString());
  const summary = buildSummary(entries);

  useEffect(() => {
    let cancelled = false;

    async function refresh({ showSpinner = false } = {}) {
      if (showSpinner) setLoading(true);

      try {
        const res = await fetch(`/api/admin/logs?limit=${limit}`, { cache: 'no-store' });
        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

        const payload = JSON.parse(text);
        if (cancelled) return;

        startTransition(() => {
          setEntries(Array.isArray(payload.entries) ? payload.entries : []);
          setLastRefreshedAt(payload.refreshed_at || new Date().toISOString());
          setError('');
        });
      } catch (refreshError) {
        if (!cancelled) {
          setError(String(refreshError?.message || refreshError));
        }
      } finally {
        if (showSpinner && !cancelled) setLoading(false);
      }
    }

    const intervalId = setInterval(() => {
      void refresh();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [limit, pollMs]);

  return (
    <>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Loaded entries" value={summary.total} helper="latest first" />
        <StatCard label="Errors" value={summary.errors} tone={summary.errors > 0 ? 'danger' : 'default'} />
        <StatCard label="Warnings" value={summary.warnings} tone={summary.warnings > 0 ? 'warn' : 'default'} />
        <StatCard label="Delivery events" value={summary.delivery} tone="success" />
        <StatCard label="Runtime events" value={summary.runtime} />
      </section>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Live application timeline</h2>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
              Auto refresh every {Math.round(pollMs / 1000)}s. Newest entries stay at the top.
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              Last refresh: {formatDateTime(lastRefreshedAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              setLoading(true);
              try {
                const res = await fetch(`/api/admin/logs?limit=${limit}`, { cache: 'no-store' });
                const text = await res.text();
                if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
                const payload = JSON.parse(text);
                startTransition(() => {
                  setEntries(Array.isArray(payload.entries) ? payload.entries : []);
                  setLastRefreshedAt(payload.refreshed_at || new Date().toISOString());
                  setError('');
                });
              } catch (refreshError) {
                setError(String(refreshError?.message || refreshError));
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #374151', background: '#111827', color: '#f8fafc', cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? 'Refreshing...' : 'Refresh now'}
          </button>
        </div>
        {error ? <div style={{ marginTop: 12, color: '#fca5a5', fontSize: 13 }}>{error}</div> : null}
      </Card>

      <section style={{ display: 'grid', gap: 12 }}>
        {entries.map((entry) => {
          const levelStyle = getLevelStyle(entry.level);
          const contextLine = buildContextLine(entry);
          const detailsLine = buildDetailsLine(entry);

          return (
            <section
              key={entry.id}
              style={{
                background: '#000000',
                border: `1px solid ${levelStyle.border}`,
                borderLeftWidth: 4,
                borderRadius: 16,
                padding: 16,
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                    {formatDateTime(entry.created_at)} | {entry.scope} | {entry.source || '-'} | {entry.event_type}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>{entry.message}</div>
                  {contextLine ? <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 8 }}>{contextLine}</div> : null}
                  {detailsLine ? <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{detailsLine}</div> : null}
                  {entry.error ? <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>error: {entry.error}</div> : null}
                </div>
                <div style={{ minWidth: 68, textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: 999, background: levelStyle.badgeBg, color: levelStyle.badgeFg, fontSize: 11, fontWeight: 700 }}>
                    {entry.level}
                  </span>
                </div>
              </div>
            </section>
          );
        })}
        {entries.length === 0 ? (
          <Card>
            <div style={{ color: '#94a3b8' }}>No logs yet.</div>
          </Card>
        ) : null}
      </section>
    </>
  );
}
