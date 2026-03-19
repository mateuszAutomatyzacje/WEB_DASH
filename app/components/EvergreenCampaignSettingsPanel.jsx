'use client';

import { useMemo, useState } from 'react';
import {
  DEFAULT_EVERGREEN_NAME,
  DEFAULT_EVERGREEN_RUNNER_CONFIG,
  SEND_INTERVAL_OPTIONS,
} from '@/lib/evergreen-config.js';

const DEFAULTS = {
  campaignName: DEFAULT_EVERGREEN_NAME,
  ...DEFAULT_EVERGREEN_RUNNER_CONFIG,
};

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCfg(raw = {}) {
  return {
    campaignName: String(raw.campaignName || DEFAULTS.campaignName).trim(),
    baseUrl: String(raw.baseUrl ?? DEFAULTS.baseUrl).trim(),
    maxPages: toNum(raw.maxPages, DEFAULTS.maxPages),
    budgetMaxRequests: toNum(raw.budgetMaxRequests, DEFAULTS.budgetMaxRequests),
    crawl4aiEndpoint: String(raw.crawl4aiEndpoint ?? DEFAULTS.crawl4aiEndpoint).trim(),
    rateSeconds: toNum(raw.rateSeconds, DEFAULTS.rateSeconds),
    jobTitle: String(raw.jobTitle ?? DEFAULTS.jobTitle),
    city: String(raw.city ?? DEFAULTS.city),
    experienceLevel: String(raw.experienceLevel ?? DEFAULTS.experienceLevel),
    testMode: Boolean(raw.testMode),
    apolloApiKey: String(raw.apolloApiKey ?? DEFAULTS.apolloApiKey),
    apolloMaxPeoplePerCompany: toNum(raw.apolloMaxPeoplePerCompany, DEFAULTS.apolloMaxPeoplePerCompany),
    runId: String(raw.runId ?? DEFAULTS.runId),
    crawl4aiHealthPath: String(raw.crawl4aiHealthPath ?? DEFAULTS.crawl4aiHealthPath).trim(),
    webhookUrl: String(raw.webhookUrl ?? DEFAULTS.webhookUrl).trim(),
    sendIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(raw.sendIntervalMin)) ? Number(raw.sendIntervalMin) : DEFAULTS.sendIntervalMin,
    leadSyncIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(raw.leadSyncIntervalMin)) ? Number(raw.leadSyncIntervalMin) : DEFAULTS.leadSyncIntervalMin,
    sendEmailIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(raw.sendEmailIntervalMin)) ? Number(raw.sendEmailIntervalMin) : DEFAULTS.sendEmailIntervalMin,
  };
}

function fromSaved(data = {}, fallback = {}) {
  const runner = data?.evergreen_runner || data?.campaign?.settings?.evergreen_runner || {};
  const sendIntervalMin = data?.send_interval_min ?? data?.campaign?.settings?.send_interval_min ?? fallback?.sendIntervalMin;
  const leadSyncIntervalMin = data?.lead_sync_interval_min ?? data?.campaign?.settings?.lead_sync_interval_min ?? fallback?.leadSyncIntervalMin;
  const sendEmailIntervalMin = data?.send_email_interval_min ?? data?.campaign?.settings?.send_email_interval_min ?? fallback?.sendEmailIntervalMin;
  return normalizeCfg({
    ...fallback,
    campaignName: data?.campaign?.name ?? fallback?.campaignName,
    webhookUrl: runner?.webhook_url,
    baseUrl: runner?.base_url,
    maxPages: runner?.max_pages,
    budgetMaxRequests: runner?.budget_max_requests,
    crawl4aiEndpoint: runner?.crawl4ai_endpoint,
    rateSeconds: runner?.rate_seconds,
    jobTitle: runner?.job_title,
    city: runner?.city,
    experienceLevel: runner?.experience_level,
    testMode: runner?.test_mode,
    apolloApiKey: runner?.apollo_api_key,
    apolloMaxPeoplePerCompany: runner?.apollo_max_people_per_company,
    runId: runner?.run_id,
    crawl4aiHealthPath: runner?.crawl4ai_health_path,
    sendIntervalMin,
    leadSyncIntervalMin,
    sendEmailIntervalMin,
  });
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

export default function EvergreenCampaignSettingsPanel({ initialName, initialConfig }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);
  const [cfg, setCfg] = useState(normalizeCfg({ ...DEFAULTS, campaignName: initialName || DEFAULTS.campaignName, ...(initialConfig || {}) }));

  const payload = useMemo(() => ({
    campaignName: String(cfg.campaignName || DEFAULTS.campaignName).trim(),
    baseUrl: String(cfg.baseUrl || '').trim(),
    maxPages: toNum(cfg.maxPages, DEFAULTS.maxPages),
    budgetMaxRequests: toNum(cfg.budgetMaxRequests, DEFAULTS.budgetMaxRequests),
    crawl4aiEndpoint: String(cfg.crawl4aiEndpoint || '').trim(),
    rateSeconds: toNum(cfg.rateSeconds, DEFAULTS.rateSeconds),
    jobTitle: String(cfg.jobTitle || '').trim(),
    city: String(cfg.city || '').trim(),
    experienceLevel: String(cfg.experienceLevel || '').trim(),
    testMode: Boolean(cfg.testMode),
    apolloApiKey: String(cfg.apolloApiKey || '').trim(),
    apolloMaxPeoplePerCompany: toNum(cfg.apolloMaxPeoplePerCompany, DEFAULTS.apolloMaxPeoplePerCompany),
    runId: String(cfg.runId || '').trim(),
    crawl4aiHealthPath: String(cfg.crawl4aiHealthPath || '').trim(),
    webhookUrl: String(cfg.webhookUrl || '').trim(),
    sendIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(cfg.sendIntervalMin)) ? Number(cfg.sendIntervalMin) : DEFAULTS.sendIntervalMin,
    leadSyncIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(cfg.leadSyncIntervalMin)) ? Number(cfg.leadSyncIntervalMin) : DEFAULTS.leadSyncIntervalMin,
    sendEmailIntervalMin: SEND_INTERVAL_OPTIONS.includes(Number(cfg.sendEmailIntervalMin)) ? Number(cfg.sendEmailIntervalMin) : DEFAULTS.sendEmailIntervalMin,
  }), [cfg]);

  async function saveOnly() {
    setLoading(true);
    setMsg('');
    try {
      const data = await callJson('/api/admin/campaign/evergreen-settings', 'PUT', payload);
      const saved = fromSaved(data, cfg);
      setCfg(saved);
      setResult(data);
      setMsg('SETTINGS SAVED');
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function trigger(mode) {
    setLoading(true);
    setMsg('');
    try {
      const savedData = await callJson('/api/admin/campaign/evergreen-settings', 'PUT', payload);
      const saved = fromSaved(savedData, cfg);
      setCfg(saved);
      const data = await callJson('/api/admin/campaign/start-evergreen', 'POST', { ...saved, mode });
      setResult(data);
      setMsg(mode === 'test' ? 'TEST WEBHOOK SENT' : 'EVERGREEN STARTED + WEBHOOK SENT');
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  const row = { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 };
  const label = { fontWeight: 700, fontSize: 13, color: '#cbd5e1' };
  const input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #374151', width: '100%', background: '#111827', color: '#f8fafc' };

  return (
    <section style={{ border: '1px solid #1f2937', borderRadius: 16, padding: 16, background: '#000', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, fontSize: 20 }}>Evergreen campaign settings</h3>
      <p style={{ marginTop: 0, color: '#94a3b8', fontSize: 13 }}>
        Edytowalne ustawienia kampanii + webhook start/test pod n8n.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={saveOnly} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Save settings'}</button>
        <button onClick={() => trigger('test')} disabled={loading} style={{ background: '#111827', color: '#f8fafc', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Send test webhook now'}</button>
        <button onClick={() => trigger('start')} disabled={loading} style={{ background: '#166534', color: '#f8fafc', border: '1px solid #16a34a', borderRadius: 8, padding: '8px 10px' }}>{loading ? '...' : 'Start evergreen + send now'}</button>
      </div>

      {msg ? <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('ERR') ? '#fca5a5' : '#86efac' }}><b>{msg}</b></div> : null}

      <div style={row}>
        <div style={label}>campaignName</div>
        <input style={input} value={cfg.campaignName} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, campaignName: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>sendIntervalMin (scraper)</div>
        <select style={input} value={cfg.sendIntervalMin} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, sendIntervalMin: Number(e.target.value) }))}>
          {SEND_INTERVAL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt} min</option>
          ))}
        </select>
      </div>
      <div style={row}>
        <div style={label}>leadSyncIntervalMin</div>
        <select style={input} value={cfg.leadSyncIntervalMin} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, leadSyncIntervalMin: Number(e.target.value) }))}>
          {SEND_INTERVAL_OPTIONS.map((opt) => (
            <option key={`lead-${opt}`} value={opt}>{opt} min</option>
          ))}
        </select>
      </div>
      <div style={row}>
        <div style={label}>sendEmailIntervalMin</div>
        <select style={input} value={cfg.sendEmailIntervalMin} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, sendEmailIntervalMin: Number(e.target.value) }))}>
          {SEND_INTERVAL_OPTIONS.map((opt) => (
            <option key={`email-${opt}`} value={opt}>{opt} min</option>
          ))}
        </select>
      </div>
      <div style={row}>
        <div style={label}>webhookUrl</div>
        <input style={input} value={cfg.webhookUrl} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, webhookUrl: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>baseUrl</div>
        <input style={input} value={cfg.baseUrl} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, baseUrl: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>maxPages</div>
        <input style={input} type="number" min={1} value={cfg.maxPages} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, maxPages: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>budgetMaxRequests</div>
        <input style={input} type="number" min={1} value={cfg.budgetMaxRequests} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, budgetMaxRequests: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>crawl4aiEndpoint</div>
        <input style={input} value={cfg.crawl4aiEndpoint} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, crawl4aiEndpoint: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>crawl4aiHealthPath</div>
        <input style={input} value={cfg.crawl4aiHealthPath} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, crawl4aiHealthPath: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>rateSeconds</div>
        <input style={input} type="number" step="0.1" min={0} value={cfg.rateSeconds} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, rateSeconds: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>jobTitle</div>
        <input style={input} value={cfg.jobTitle} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, jobTitle: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>city</div>
        <input style={input} value={cfg.city} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, city: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>experienceLevel</div>
        <select style={input} value={cfg.experienceLevel} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, experienceLevel: e.target.value }))}>
          <option value="">Any</option>
          <option value="junior">junior</option>
          <option value="mid">mid</option>
          <option value="senior">senior</option>
        </select>
      </div>
      <div style={row}>
        <div style={label}>testMode</div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={Boolean(cfg.testMode)} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, testMode: e.target.checked }))} />
          <span style={{ fontSize: 13, color: '#94a3b8' }}>Do payloadu idzie jako boolean</span>
        </label>
      </div>
      <div style={row}>
        <div style={label}>apolloApiKey</div>
        <input style={input} type="password" value={cfg.apolloApiKey} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, apolloApiKey: e.target.value }))} placeholder="opcjonalnie" />
      </div>
      <div style={row}>
        <div style={label}>apolloMaxPeoplePerCompany</div>
        <input style={input} type="number" min={1} value={cfg.apolloMaxPeoplePerCompany} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, apolloMaxPeoplePerCompany: e.target.value }))} />
      </div>
      <div style={row}>
        <div style={label}>runId</div>
        <input style={input} value={cfg.runId} onChange={(e) => setCfg((c) => normalizeCfg({ ...c, runId: e.target.value }))} placeholder="opcjonalnie" />
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: '#cbd5e1' }}>Payload preview</summary>
        <pre style={{ marginTop: 10, background: '#020617', color: '#e2e8f0', padding: 10, borderRadius: 12, overflowX: 'auto', fontSize: 12, border: '1px solid #1f2937' }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>

      {result ? (
        <pre style={{ marginTop: 10, background: '#020617', color: '#e2e8f0', padding: 10, borderRadius: 12, overflowX: 'auto', fontSize: 12, border: '1px solid #1f2937' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
