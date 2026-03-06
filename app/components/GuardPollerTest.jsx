'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const INTERVAL_MS = 10 * 60 * 1000;

export default function GuardPollerTest() {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [lastStatus, setLastStatus] = useState('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [runs, setRuns] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('guardPollerActive') : null;
    if (saved === '1') setActive(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('guardPollerActive', active ? '1' : '0');

    if (!active) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setLastStatus('running');
        const res = await fetch('/api/admin/campaign-guard/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: null, limit: 100, dry_run: false }),
        });
        const data = await res.json().catch(() => ({}));
        setLastRunAt(new Date().toISOString());
        setRuns((n) => n + 1);
        if (!res.ok || data?.ok === false) {
          setLastStatus('error');
          setLastMsg(data?.response?.error || data?.raw || `HTTP ${res.status}`);
        } else {
          setLastStatus('ok');
          const r = data?.response || {};
          setLastMsg(`processed=${r.processed ?? '-'} sent=${r.sent ?? '-'} stopped=${r.stopped ?? '-'} failed=${r.failed ?? '-'}`);
        }
      } catch (e) {
        setLastRunAt(new Date().toISOString());
        setLastStatus('error');
        setLastMsg(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };

    run(); // immediate run on activate
    timerRef.current = setInterval(run, INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active]);

  const badgeStyle = useMemo(() => ({
    display: 'inline-block',
    marginLeft: 10,
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 12,
    color: '#fff',
    background: active ? '#0a7d22' : '#777',
  }), [active]);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Campaign Guard Poller (TEST)</strong>
        <span style={badgeStyle}>{active ? 'ACTIVE' : 'OFF'}</span>
      </div>
      <p style={{ margin: '8px 0', fontSize: 13 }}>
        Po włączeniu wysyła request do webhooka co 10 minut (i raz od razu).
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setActive((v) => !v)} disabled={loading}>
          {active ? 'Stop polling' : 'Start polling'}
        </button>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const res = await fetch('/api/admin/campaign-guard/poll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaign_id: null, limit: 100, dry_run: false }),
              });
              const data = await res.json().catch(() => ({}));
              setLastRunAt(new Date().toISOString());
              setRuns((n) => n + 1);
              if (!res.ok || data?.ok === false) {
                setLastStatus('error');
                setLastMsg(data?.response?.error || data?.raw || `HTTP ${res.status}`);
              } else {
                setLastStatus('ok');
                const r = data?.response || {};
                setLastMsg(`processed=${r.processed ?? '-'} sent=${r.sent ?? '-'} stopped=${r.stopped ?? '-'} failed=${r.failed ?? '-'}`);
              }
            } catch (e) {
              setLastStatus('error');
              setLastMsg(String(e?.message || e));
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
        >
          Run now
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
        <div>Runs: {runs}</div>
        <div>Last run: {lastRunAt ? new Date(lastRunAt).toLocaleString() : '-'}</div>
        <div>Status: {lastStatus}</div>
        <div>Info: {lastMsg || '-'}</div>
      </div>
    </div>
  );
}
