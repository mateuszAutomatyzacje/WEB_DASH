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
  try {
    data = JSON.parse(txt);
  } catch {
    data = { raw: txt };
  }
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
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, fontSize: 20 }}>Queue preview</h3>
      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 10 }}>
        Tutaj sprawdzisz, czy rekordy z <code>campaign_leads</code> trafiaja do kolejki mailowej. Glowny status automatycznej wysylki jest w panelu Email sending.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => run('sync')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Sync leads -> campaign_leads'}</button>
        <button onClick={() => run('preview')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Preview outbox (dry-run)'}</button>
      </div>
      {msg ? <div style={{ marginTop: 8, fontSize: 13, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac' }}>{msg}</div> : null}
      {result ? (
        <>
          {Array.isArray(result?.outbox_preview) && result.outbox_preview.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 6, color: '#cbd5e1' }}><b>Queue ready for email send</b></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>to_email</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>subject</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>attempt</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>campaign_lead_id</th>
                  </tr>
                </thead>
                <tbody>
                  {result.outbox_preview.map((row) => (
                    <tr key={`${row.campaign_lead_id}-${row.message_attempt_id}`}>
                      <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.to_email}</td>
                      <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.send_subject}</td>
                      <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.contact_attempt_no}</td>
                      <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.campaign_lead_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <pre style={{ marginTop: 10, background: '#020617', color: '#e2e8f0', padding: 10, borderRadius: 12, overflowX: 'auto', fontSize: 12, border: '1px solid #1f2937' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </>
      ) : null}
    </section>
  );
}
