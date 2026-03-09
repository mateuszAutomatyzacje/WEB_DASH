'use client';

import { useMemo, useState } from 'react';

function numOrNull(v) {
  if (v === '' || v === null || typeof v === 'undefined') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function callJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.message || txt || `HTTP ${res.status}`);
  return data;
}

export default function ScrapeSettingsPanel({ initial }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState(initial);

  const payload = useMemo(() => ({
    running: Boolean(cfg?.running),
    baseUrl: String(cfg?.base_url || '').trim(),
    maxPages: Number(cfg?.max_pages ?? 3),
    budgetMaxRequests: Number(cfg?.budget_max_requests ?? 120),
    crawl4aiEndpoint: String(cfg?.crawl4ai_endpoint || '').trim(),
    rateSeconds: Number(cfg?.rate_seconds ?? 1),
    jobTitle: (cfg?.job_title === null || typeof cfg?.job_title === 'undefined') ? null : String(cfg?.job_title),
    city: (cfg?.city === null || typeof cfg?.city === 'undefined') ? null : String(cfg?.city),
    experienceLevel: cfg?.experience_level ? String(cfg.experience_level) : null,
    testMode: Boolean(cfg?.test_mode),
    apolloMaxPeoplePerCompany: cfg?.apollo_max_people_per_company === null || typeof cfg?.apollo_max_people_per_company === 'undefined'
      ? null
      : Number(cfg.apollo_max_people_per_company),
  }), [cfg]);

  async function save() {
    setLoading(true);
    setMsg('');
    try {
      const data = await callJson('/api/admin/scrape-settings', 'PUT', payload);
      setCfg(data.settings);
      setMsg('SAVED');
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function runNow() {
    setLoading(true);
    setMsg('');
    try {
      const data = await callJson('/api/admin/scrape/run', 'POST', {});
      setCfg((c) => ({
        ...c,
        last_run_id: data?.runId || c?.last_run_id,
        last_run_status: data?.status || 'queued',
        last_run_at: data?.last_run_at || new Date().toISOString(),
      }));
      setMsg(`RUN QUEUED: ${data?.runId || '-'}`);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  const row = { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 };
  const label = { fontWeight: 700, fontSize: 13 };
  const input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', width: '100%' };

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Scraper settings</h3>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={save} disabled={loading}>{loading ? '...' : 'Save'}</button>
        <button onClick={runNow} disabled={loading}>{loading ? '...' : 'Run now'}</button>
      </div>

      {msg ? <div style={{ marginBottom: 12, fontSize: 13 }}><b>{msg}</b></div> : null}

      <div style={row}>
        <div style={label}>RUNNING</div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(cfg?.running)}
            onChange={(e) => setCfg((c) => ({ ...c, running: e.target.checked }))}
          />
          <span style={{ fontSize: 13, color: '#444' }}>Jeśli włączone, cron będzie odpalał run co godzinę</span>
        </label>
      </div>

      <hr style={{ margin: '14px 0', border: 0, borderTop: '1px solid #eee' }} />

      <div style={row}>
        <div style={label}>baseUrl</div>
        <input style={input} value={cfg?.base_url ?? ''} onChange={(e) => setCfg((c) => ({ ...c, base_url: e.target.value }))} />
      </div>

      <div style={row}>
        <div style={label}>crawl4aiEndpoint</div>
        <input style={input} value={cfg?.crawl4ai_endpoint ?? ''} onChange={(e) => setCfg((c) => ({ ...c, crawl4ai_endpoint: e.target.value }))} />
      </div>

      <div style={row}>
        <div style={label}>jobTitle</div>
        <input style={input} value={cfg?.job_title ?? ''} onChange={(e) => setCfg((c) => ({ ...c, job_title: e.target.value }))} placeholder="np. AI Automation" />
      </div>

      <div style={row}>
        <div style={label}>city</div>
        <input style={input} value={cfg?.city ?? ''} onChange={(e) => setCfg((c) => ({ ...c, city: e.target.value }))} placeholder="np. Poland" />
      </div>

      <div style={row}>
        <div style={label}>experienceLevel</div>
        <select
          style={input}
          value={cfg?.experience_level ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, experience_level: e.target.value || null }))}
        >
          <option value="">Any (null)</option>
          <option value="junior">junior</option>
          <option value="mid">mid</option>
          <option value="senior">senior</option>
        </select>
      </div>

      <div style={row}>
        <div style={label}>testMode</div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(cfg?.test_mode)}
            onChange={(e) => setCfg((c) => ({ ...c, test_mode: e.target.checked }))}
          />
        </label>
      </div>

      <div style={row}>
        <div style={label}>maxPages</div>
        <input
          style={input}
          type="number"
          value={cfg?.max_pages ?? 3}
          min={1}
          onChange={(e) => setCfg((c) => ({ ...c, max_pages: Number(e.target.value || 1) }))}
        />
      </div>

      <div style={row}>
        <div style={label}>budgetMaxRequests</div>
        <input
          style={input}
          type="number"
          value={cfg?.budget_max_requests ?? 120}
          min={1}
          onChange={(e) => setCfg((c) => ({ ...c, budget_max_requests: Number(e.target.value || 1) }))}
        />
      </div>

      <div style={row}>
        <div style={label}>rateSeconds</div>
        <input
          style={input}
          type="number"
          step="0.1"
          value={cfg?.rate_seconds ?? 1}
          min={0}
          onChange={(e) => setCfg((c) => ({ ...c, rate_seconds: Number(e.target.value || 0) }))}
        />
      </div>

      <div style={row}>
        <div style={label}>apolloMaxPeoplePerCompany</div>
        <input
          style={input}
          type="number"
          value={cfg?.apollo_max_people_per_company ?? ''}
          min={1}
          placeholder="null = unlimited"
          onChange={(e) => setCfg((c) => ({ ...c, apollo_max_people_per_company: numOrNull(e.target.value) }))}
        />
      </div>

      <hr style={{ margin: '14px 0', border: 0, borderTop: '1px solid #eee' }} />

      <div style={{ fontSize: 13, display: 'grid', gap: 6 }}>
        <div><b>Last run ID:</b> {cfg?.last_run_id || '-'}</div>
        <div><b>Status:</b> {cfg?.last_run_status || '-'}</div>
        <div><b>Last run at:</b> {cfg?.last_run_at ? String(cfg.last_run_at) : '-'}</div>
        <div style={{ color: '#666' }}><b>locked_until:</b> {cfg?.locked_until ? String(cfg.locked_until) : '-'}</div>
      </div>
    </section>
  );
}
