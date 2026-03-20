'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime } from '@/lib/time.js';

export default function AutoSyncControlPanel({ campaignName, initial, campaignStatus = 'unknown' }) {
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
      campaign_status: data?.campaign?.status || data?.status || prev.campaign_status || campaignStatus,
      lead_sync_interval_min: Number(s.lead_sync_interval_min || prev.lead_sync_interval_min || 30),
      last_sync_at: s.last_sync_at || prev.last_sync_at || '',
      last_sync_result: s.last_sync_result || data?.sync || prev.last_sync_result || null,
      next_expected_sync_at: s.next_expected_sync_at || data?.next_expected_sync_at || prev.next_expected_sync_at || '',
      updated_at: s.auto_sync_updated_at || new Date().toISOString(),
    }));
  }

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      const path = action === 'tick' ? '/api/admin/campaign/cron-sync' : '/api/admin/campaign/auto-sync';
      const body = action === 'tick'
        ? { campaign_name: campaignName, lead_sync_interval_min: state.lead_sync_interval_min || 30, dry_run: false }
        : { name: campaignName, action, interval_min: state.lead_sync_interval_min || 30 };
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
        <div><b>Campaign status:</b> <span style={{ color: state.campaign_status === 'running' ? '#86efac' : '#fca5a5', fontWeight: 700 }}>{state.campaign_status || campaignStatus || 'unknown'}</span></div>
        <div><b>Enabled:</b> {state.enabled ? 'yes' : 'no'}</div>
        <div><b>Status:</b> <span style={{ color: state.status === 'running' ? '#86efac' : state.status === 'error' ? '#fca5a5' : '#fdba74', fontWeight: 700 }}>{state.status || 'unknown'}</span></div>
        <div><b>Interval:</b> every {state.lead_sync_interval_min || 30} min</div>
        <div><b>Last sync:</b> {formatDateTime(state.last_sync_at)}</div>
        <div><b>Next expected sync:</b> {formatDateTime(state.next_expected_sync_at)}</div>
        <div><b>Last result:</b> {state.last_sync_result ? `inserted=${state.last_sync_result.inserted ?? 0}, updated=${state.last_sync_result.updated ?? 0}, tagged=${state.last_sync_result.tagged_attempts ?? 0}` : '-'}</div>
        <div><b>Scheduler:</b> WebDash sprawdza due kampanie co ok. 60 sekund i odpala sync leadow wedlug <code>lead_sync_interval_min</code> z DB. Zewnetrzny cron na <code>POST /api/admin/campaign/cron-sync</code> jest nadal opcjonalny.</div>
      </div>
      {state.campaign_status !== 'running' ? (
        <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6, marginBottom: 12 }}>
          Auto-sync is blocked while the overall campaign status is <b>{state.campaign_status || campaignStatus || 'unknown'}</b>. Scheduler runs require the campaign itself to be <b>running</b>.
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('start')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Start Auto Sync'}</button>
        <button onClick={() => run('stop')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Stop Auto Sync'}</button>
        <button onClick={() => run('tick')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Run scheduler tick'}</button>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac', fontSize: 13 }}>{msg}</div> : null}
    </section>
  );
}
