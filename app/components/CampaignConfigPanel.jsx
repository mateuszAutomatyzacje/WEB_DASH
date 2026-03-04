'use client';

import { useEffect, useMemo, useState } from 'react';

const STATUSES = ['draft', 'ready', 'running', 'paused', 'stopped', 'archived'];

export default function CampaignConfigPanel() {
  const [name, setName] = useState('OUTSOURCING_IT_EVERGREEM');
  const [description, setDescription] = useState('Kampania ciągła dla nowych leadów');
  const [settingsText, setSettingsText] = useState('{"mode":"evergreen","send_interval_min":5}');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('unknown');

  async function refreshStatus(targetName = name) {
    try {
      const res = await fetch(`/api/admin/campaign/get-status?name=${encodeURIComponent(targetName)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.found && data?.status) setCurrentStatus(data.status);
      else setCurrentStatus('not_created');
    } catch {
      setCurrentStatus('unknown');
    }
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeStyle = useMemo(() => {
    if (currentStatus === 'running') return { background: '#0a7d22', color: '#fff' };
    if (currentStatus === 'paused') return { background: '#8a6d00', color: '#fff' };
    if (currentStatus === 'stopped') return { background: '#a00020', color: '#fff' };
    if (currentStatus === 'not_created') return { background: '#666', color: '#fff' };
    return { background: '#2d2d2d', color: '#fff' };
  }, [currentStatus]);

  async function callApi(path, body) {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      setMsg(`OK: ${data?.campaign_id || data?.id || 'done'}`);
      await refreshStatus(body?.name || name);
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Campaign config (test/admin)</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(480px, 760px) 220px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          </label>

          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
          </label>

          <label>
            Settings JSON
            <textarea rows={4} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} style={{ width: '100%' }} />
          </label>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              disabled={loading}
              onClick={async () => {
                let settings = {};
                try { settings = settingsText ? JSON.parse(settingsText) : {}; } catch { setMsg('ERR: settings JSON invalid'); return; }
                await callApi('/api/admin/campaign/create', { name, description, status: 'running', settings });
              }}
            >
              Create campaign
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/ensure-evergreen', { name })}>
              Ensure evergreen running
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { name, status: 'stopped' })}>
              Stop evergreen
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { name, status: 'running' })}>
              Start evergreen
            </button>
          </div>
        </div>

        <aside style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, fontSize: 12 }}>
          <b>Statusy kampanii</b>
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-block', borderRadius: 999, padding: '3px 10px', fontSize: 12, ...badgeStyle }}>
              current: {currentStatus}
            </span>
          </div>
          <ul style={{ margin: '8px 0 0 16px', padding: 0, lineHeight: 1.7 }}>
            {STATUSES.map((s) => (
              <li key={s} style={s === currentStatus ? { fontWeight: 700, color: '#0a7d22' } : undefined}>{s}</li>
            ))}
          </ul>
        </aside>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
