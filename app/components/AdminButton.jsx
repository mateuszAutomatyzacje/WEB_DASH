'use client';

import { useState } from 'react';

export default function AdminButton({
  label,
  action,
  body,
  confirmText,
  onDone,
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function run() {
    if (confirmText && !confirm(confirmText)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : '{}',
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
      setMsg('OK');
      onDone?.();
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      <button onClick={run} disabled={loading}>
        {loading ? '...' : label}
      </button>
      {msg ? <span style={{ fontSize: 12, color: msg === 'OK' ? '#0a0' : '#a00' }}>{msg}</span> : null}
    </span>
  );
}
