'use client';

import { useState } from 'react';

const td = { borderBottom: '1px solid #111827', padding: '8px 6px', verticalAlign: 'top', color: '#f8fafc' };
const th = { textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '8px 6px', color: '#94a3b8' };

function getMonitorStatus(r) {
  const event = (r.latest_event_type || '').toLowerCase();
  const stopReason = (r.stop_reason || '').toLowerCase();
  const n = Number(r.contact_attempt_no || 1);

  if (event === 'replied' || stopReason === 'replied') {
    return { label: 'GREEN: reply', color: '#86efac', bg: '#052e16' };
  }
  if (['bounced', 'complained', 'unsubscribed', 'failed'].includes(event)) {
    return { label: `RED: ${event}`, color: '#fca5a5', bg: '#450a0a' };
  }
  if (n >= 4) {
    return { label: 'RED: brak odpowiedzi po FU2', color: '#fca5a5', bg: '#450a0a' };
  }
  if (n === 1) {
    return { label: 'YELLOW: po main, czeka na FU1', color: '#fdba74', bg: '#451a03' };
  }
  if (n === 2) {
    return { label: 'YELLOW: po FU1, czeka na FU2', color: '#fdba74', bg: '#451a03' };
  }
  return { label: 'YELLOW: po FU2, oczekiwanie', color: '#fdba74', bg: '#451a03' };
}

export default function CampaignGuardTable({ rows = [] }) {
  const [loadingId, setLoadingId] = useState(null);
  const [msg, setMsg] = useState('');

  async function runAction(campaignLeadId, action) {
    setLoadingId(campaignLeadId + action);
    setMsg('');
    try {
      const res = await fetch('/api/admin/campaign-guard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_lead_id: campaignLeadId, action }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setMsg(`OK: ${action}`);
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div>
      {msg ? <div style={{ marginBottom: 8, fontSize: 12, color: '#cbd5e1' }}>{msg}</div> : null}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>company</th>
            <th style={th}>contact</th>
            <th style={th}>email</th>
            <th style={th}>state</th>
            <th style={th}>attempt</th>
            <th style={th}>next_run_at</th>
            <th style={th}>latest_event</th>
            <th style={th}>monitoring</th>
            <th style={th}>actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const contact = [r.first_name, r.last_name].filter(Boolean).join(' ') || '-';
            const monitor = getMonitorStatus(r);
            const actions = [
              ['stop', 'Stop'],
              ['resume', 'Resume'],
              ['requeue', 'Requeue +5m'],
              ['mark_replied', 'Mark replied'],
              ['mark_failed', 'Mark failed'],
            ];
            return (
              <tr key={r.campaign_lead_id}>
                <td style={td}>{r.company_name || '-'}</td>
                <td style={td}>{contact}</td>
                <td style={td}>{r.email || '-'}</td>
                <td style={td}>{r.state}{r.stop_reason ? ` (${r.stop_reason})` : ''}</td>
                <td style={td}>{r.contact_attempt_no ?? '-'}</td>
                <td style={td}>{r.next_run_at ? String(r.next_run_at) : '-'}</td>
                <td style={td}>{r.latest_event_type || '-'}</td>
                <td style={td}>
                  <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 999, background: monitor.bg, color: monitor.color, fontSize: 12 }}>
                    {monitor.label}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {actions.map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => runAction(r.campaign_lead_id, key)}
                        disabled={loadingId === r.campaign_lead_id + key}
                        style={{ fontSize: 11, background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '6px 8px' }}
                      >
                        {loadingId === r.campaign_lead_id + key ? '...' : label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td style={td} colSpan={9}>No leads in campaign</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
