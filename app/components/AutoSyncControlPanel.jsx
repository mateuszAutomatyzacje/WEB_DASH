'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AutoSyncControlPanel({ campaignName, initial }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [state, setState] = useState(initial);

  function applyState(data, fallbackStatus) {
    const s = data?.settings || {};
    setState((prev) => ({
      ...prev,
      enabled: typeof data?.auto_sync_enabled === 'boolean' ? data.auto_sync_enabled : Boolean(s.auto_sync_enabled ?? prev.enabled),
      status: s.auto_sync_status || data?.status || fallbackStatus || prev.status || 'unknown',
      sync_interval_min: Number(s.sync_interval_min || prev.sync_interval_min || 10),
      last_sync_at: s.last_sync_at || data?.next_expected_run_at || prev.last_sync_at || '',
      last_sync_result: s.last_sync_result || data?.sync || prev.last_sync_result || null,
      updated_at: s.auto_sync_updated_at || new Date().toISOString(),
    }));
  }

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      const path = action === 'tick' ? '/api/admin/campaign/cron-sync' : '/api/admin/campaign/auto-sync';
      const body = action === 'tick'
        ? { campaign_name: campaignName, interval_min: state.sync_interval_min || 10, limit: 25, dry_run: false }
        : { name: campaignName, action, interval_min: state.sync_interval_min || 10 };
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      applyState(data, action === 'start' || action === 'tick' ? 'running' : 'paused');
      setMsg(
        action === 'tick'
          ? `CRON OK: queued=${data?.queued ?? 0} sent=${data?.sent ?? 0} failed=${data?.failed ?? 0}`
          : (action === 'start' ? 'AUTO SYNC RUNNING' : 'AUTO SYNC PAUSED'),
      );
      router.refresh();
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, fontSize: 20 }}>Lead sync status</h3>
      <div style={{ display: 'grid', gap: 8, fontSize: 14, marginBottom: 14 }}>
        <div><b>Enabled:</b> {state.enabled ? 'yes' : 'no'}</div>
        <div><b>Status:</b> <span style={{ color: state.status === 'running' ? '#86efac' : state.status === 'error' ? '#fca5a5' : '#fdba74', fontWeight: 700 }}>{state.status || 'unknown'}</span></div>
        <div><b>Interval:</b> every {state.sync_interval_min || 10} min</div>
        <div><b>Last sync:</b> {state.last_sync_at || '-'}</div>
        <div><b>Last result:</b> {state.last_sync_result ? `inserted=${state.last_sync_result.inserted ?? 0}, updated=${state.last_sync_result.updated ?? 0}, tagged=${state.last_sync_result.tagged_attempts ?? 0}` : '-'}</div>
        <div><b>Scheduler:</b> odpalaj cron na <code>POST /api/admin/campaign/cron-sync</code> co 10 min. Ten tick robi sync leadow i live send due maili.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('start')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Start Auto Sync'}</button>
        <button onClick={() => run('stop')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Stop Auto Sync'}</button>
        <button onClick={() => run('tick')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Run scheduler tick'}</button>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac', fontSize: 13 }}>{msg}</div> : null}
    </section>
  );
}
