'use client';

import { useState } from 'react';

const defaultBody = {
  campaign_name: 'OUTSOURCING_IT_EVERGREEM',
  campaign_id: null,
  limit: 25,
};

async function callJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(data?.error || data?.message || txt || `HTTP ${res.status}`);
  return data;
}

export default function EvergreenControlPanel() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      if (action === 'sync') {
        const data = await callJson('/api/admin/campaign/sync-leads', defaultBody);
        setResult(data);
        setMsg('SYNC OK');
      }
      if (action === 'preview') {
        const data = await callJson('/api/admin/campaign-guard/run', { ...defaultBody, dry_run: true });
        setResult(data);
        setMsg(`PREVIEW OK: queued=${data?.queued ?? 0}`);
      }
      if (action === 'send') {
        if (!confirm('Uruchomić LIVE wysyłkę?')) return;
        const data = await callJson('/api/admin/campaign-guard/run', { ...defaultBody, dry_run: false });
        setResult(data);
        setMsg(`SEND OK: sent=${data?.sent ?? 0} failed=${data?.failed ?? 0}`);
      }
      if (action === 'poll') {
        const data = await callJson('/api/admin/campaign-guard/poll', { ...defaultBody, dry_run: false, limit: 100 });
        setResult(data);
        setMsg('POLL OK');
      }
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Kontrola Evergreen (WebDash)</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('sync')} disabled={loading}>{loading ? '...' : 'Sync leadów -> campaign_leads'}</button>
        <button onClick={() => run('preview')} disabled={loading}>{loading ? '...' : 'Preview outbox (dry-run)'}</button>
        <button onClick={() => run('send')} disabled={loading}>{loading ? '...' : 'Send now (LIVE)'}</button>
        <button onClick={() => run('poll')} disabled={loading}>{loading ? '...' : 'Run legacy poll (n8n)'}</button>
      </div>
      {msg ? <div style={{ marginTop: 8, fontSize: 13 }}>{msg}</div> : null}
      {result ? (
        <pre style={{ marginTop: 10, background: '#111', color: '#eee', padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
