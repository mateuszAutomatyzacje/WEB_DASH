'use client';

import { useState } from 'react';

export default function AutoSyncControlPanel({ campaignName, initial }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [state, setState] = useState(initial);

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/campaign/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaignName, action, interval_min: state.sync_interval_min || 10 }),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      const s = data?.settings || {};
      setState((prev) => ({
        ...prev,
        enabled: Boolean(s.auto_sync_enabled),
        status: s.auto_sync_status || data?.status || (action === 'start' ? 'running' : 'paused'),
        sync_interval_min: Number(s.sync_interval_min || prev.sync_interval_min || 10),
        last_sync_at: s.last_sync_at || prev.last_sync_at || '',
        last_sync_result: s.last_sync_result || prev.last_sync_result || null,
        updated_at: s.auto_sync_updated_at || new Date().toISOString(),
      }));
      setMsg(action === 'start' ? 'AUTO SYNC RUNNING' : 'AUTO SYNC PAUSED');
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, fontSize: 20 }}>Auto Sync status</h3>
      <div style={{ display: 'grid', gap: 8, fontSize: 14, marginBottom: 14 }}>
        <div><b>Enabled:</b> {state.enabled ? 'yes' : 'no'}</div>
        <div><b>Status:</b> <span style={{ color: state.status === 'running' ? '#86efac' : state.status === 'error' ? '#fca5a5' : '#fdba74', fontWeight: 700 }}>{state.status || 'unknown'}</span></div>
        <div><b>Interval:</b> every {state.sync_interval_min || 10} min</div>
        <div><b>Last sync:</b> {state.last_sync_at || '-'}</div>
        <div><b>Last result:</b> {state.last_sync_result ? `inserted=${state.last_sync_result.inserted ?? 0}, updated=${state.last_sync_result.updated ?? 0}` : '-'}</div>
        <div><b>Scheduler:</b> odpalaj cron na <code>POST /api/admin/campaign-guard/poll</code> co 10 min</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('start')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Start Auto Sync'}</button>
        <button onClick={() => run('stop')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Stop Auto Sync'}</button>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac', fontSize: 13 }}>{msg}</div> : null}
    </section>
  );
}
