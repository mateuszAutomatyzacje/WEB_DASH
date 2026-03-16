'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function renderLastResult(result) {
  if (!result) return '-';
  return `sent=${result.sent ?? 0}, failed=${result.failed ?? 0}, queued=${result.queued ?? 0}`;
}

function renderNextDue(nextDue) {
  if (!nextDue) return '-';
  const when = nextDue.next_run_at ? String(nextDue.next_run_at) : 'now';
  const who = nextDue.to_email || '-';
  const company = nextDue.company_name || '-';
  return `${who} | ${company} | attempt ${nextDue.contact_attempt_no ?? '-'} | ${when}`;
}

export default function EmailSendingControlPanel({ campaignName, campaignId, initial }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [state, setState] = useState(initial);
  const [result, setResult] = useState(null);

  function applyState(data, fallbackStatus) {
    setState((prev) => ({
      ...prev,
      enabled: typeof data?.auto_send_enabled === 'boolean' ? data.auto_send_enabled : prev.enabled,
      status: data?.auto_send_status || fallbackStatus || prev.status || 'unknown',
      queued_now: Number(data?.queued_now ?? prev.queued_now ?? 0),
      next_due_email: data?.next_due_email || prev.next_due_email || null,
      last_auto_send_at: data?.last_auto_send_at || prev.last_auto_send_at || '',
      last_scheduler_result: data?.last_scheduler_result || prev.last_scheduler_result || null,
      last_manual_send_at: data?.last_manual_send_at || prev.last_manual_send_at || '',
      last_manual_send_result: data?.last_manual_send_result || prev.last_manual_send_result || null,
      last_test_send_at: data?.last_test_send_at || prev.last_test_send_at || '',
      last_test_send_result: data?.last_test_send_result || prev.last_test_send_result || null,
    }));
  }

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/campaign/auto-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          campaign_id: campaignId,
          campaign_name: campaignName,
          limit: action === 'test' ? 5 : 25,
        }),
      });
      const text = await res.text();
      const data = parseJson(text);
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);

      applyState(data, action === 'start' ? 'running' : action === 'stop' ? 'paused' : state.status);
      setResult(data);
      if (action === 'start') setMsg('AUTO EMAIL SENDING RUNNING');
      if (action === 'stop') setMsg('AUTO EMAIL SENDING PAUSED');
      if (action === 'test') setMsg(`PREVIEW OK: queued=${data?.queued ?? 0} (no webhook call)`);
      if (action === 'send_now') setMsg(`SEND OK: sent=${data?.sent ?? 0} failed=${data?.failed ?? 0}`);
      router.refresh();
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, fontSize: 20 }}>Email sending status</h3>
      <div style={{ display: 'grid', gap: 8, fontSize: 14, marginBottom: 14 }}>
        <div><b>Enabled:</b> {state.enabled ? 'yes' : 'no'}</div>
        <div><b>Status:</b> <span style={{ color: state.status === 'running' ? '#86efac' : '#fdba74', fontWeight: 700 }}>{state.status || 'unknown'}</span></div>
        <div><b>Queued to send now:</b> {state.queued_now ?? 0}</div>
        <div><b>Sent in last scheduler run:</b> {state.last_scheduler_result?.sent ?? 0}</div>
        <div><b>Failed in last scheduler run:</b> {state.last_scheduler_result?.failed ?? 0}</div>
        <div><b>Last auto-send at:</b> {state.last_auto_send_at || '-'}</div>
        <div><b>Last manual live send at:</b> {state.last_manual_send_at || '-'}</div>
        <div><b>Last manual live result:</b> {renderLastResult(state.last_manual_send_result)}</div>
        <div><b>Next due email:</b> {renderNextDue(state.next_due_email)}</div>
        <div><b>Last send result:</b> {renderLastResult(state.last_scheduler_result)}</div>
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 12 }}>
        Preview only nie robi requestu do n8n. Request do webhooka idzie tylko przez <b>Send now (LIVE)</b> albo scheduler <code>POST /api/admin/campaign/cron-sync</code>, gdy email sending jest wlaczony.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('start')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Start sending emails'}</button>
        <button onClick={() => run('stop')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Stop sending emails'}</button>
        <button onClick={() => run('test')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Preview only (no webhook)'}</button>
        <button onClick={() => run('send_now')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Send now (LIVE)'}</button>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac', fontSize: 13 }}>{msg}</div> : null}

      {result && Array.isArray(result.outbox_preview) && result.outbox_preview.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: '#cbd5e1' }}><b>Send candidates</b></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>to_email</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>subject</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #1f2937', padding: '6px 4px', color: '#94a3b8' }}>attempt</th>
              </tr>
            </thead>
            <tbody>
              {result.outbox_preview.map((row) => (
                <tr key={`${row.campaign_lead_id}-${row.message_attempt_id}`}>
                  <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.to_email}</td>
                  <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.send_subject}</td>
                  <td style={{ borderBottom: '1px solid #111827', padding: '6px 4px' }}>{row.contact_attempt_no}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
