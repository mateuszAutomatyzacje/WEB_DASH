'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime } from '@/lib/time.js';

function renderLastRun(run) {
  if (!run) return '-';
  return `${run.status || 'unknown'} · rows=${run.record_count ?? 0} · ${formatDateTime(run.completed_at || run.created_at)}`;
}

export default function ExportDigestControlPanel({ initial }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function run(action) {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/export/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);

      const nextState = data?.status || state;
      setState(nextState);
      if (data?.result?.reason === 'no_new_records' || data?.result?.reason === 'no_test_rows') {
        setMsg('No new export rows to send');
      } else if (data?.result?.skipped) {
        setMsg(`Skipped: ${data?.result?.reason || 'unknown'}`);
      } else if (action === 'test') {
        setMsg(`Test email sent: rows=${data?.result?.row_count ?? 0}`);
      } else {
        setMsg(`Export sent: rows=${data?.result?.row_count ?? 0}`);
      }
      router.refresh();
    } catch (error) {
      setMsg(`ERR: ${String(error?.message || error)}`);
    } finally {
      setLoading(false);
    }
  }

  const config = state?.config || {};
  const latestRun = state?.latest_run || null;

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h2 style={{ marginTop: 0 }}>Daily export email</h2>
      <div style={{ display: 'grid', gap: 8, fontSize: 14, marginBottom: 14 }}>
        <div><b>Recipient:</b> {config.recipientEmail || '-'}</div>
        <div><b>Auto send:</b> enabled</div>
        <div><b>Schedule:</b> daily at {config.sendAtLocal || '08:00:00'} ({config.timeZone || 'Europe/Warsaw'})</div>
        <div><b>Campaign:</b> {config.campaignName || '-'}</div>
        <div><b>Scope:</b> {config.scope || '-'}</div>
        <div><b>Pending new rows:</b> {state?.pending_count ?? 0}</div>
        <div><b>Next scheduled send:</b> {formatDateTime(state?.next_scheduled_at)}</div>
        <div><b>Last run:</b> {renderLastRun(latestRun)}</div>
        <div><b>Webhook:</b> <span style={{ color: '#94a3b8' }}>{config.webhookUrl || '-'}</span></div>
        <div><b>Binary field:</b> <span style={{ color: '#94a3b8' }}>{config.binaryFieldName || 'data'}</span></div>
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 12 }}>
        Ten job wysyla codziennie o <b>08:00</b> mail na <b>{config.recipientEmail || '-'}</b> z zalacznikiem Excel <b>XLSX</b> i tylko z rekordami, ktore nie byly jeszcze wyslane w tym digescie. <b>Test send</b> uderza w ten sam webhook, ale nie oznacza rekordow jako juz wyslane. <b>Send export now</b> robi prawdziwy manualny digest i zapisuje dispatch w DB.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => run('test')}
          disabled={loading}
          style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}
        >
          {loading ? '...' : 'Test send email'}
        </button>
        <button
          onClick={() => run('send_now')}
          disabled={loading}
          style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}
        >
          {loading ? '...' : 'Send export now'}
        </button>
      </div>
      {msg ? (
        <div style={{ marginTop: 10, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac', fontSize: 13 }}>
          {msg}
        </div>
      ) : null}
    </section>
  );
}
