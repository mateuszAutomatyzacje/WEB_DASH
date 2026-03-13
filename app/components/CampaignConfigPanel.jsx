'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const STATUSES = ['draft', 'ready', 'running', 'paused', 'stopped', 'archived'];
const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';
const DEFAULT_DESCRIPTION = 'Kampania ciągła dla nowych leadów';
const LAST_CAMPAIGN_NAME_KEY = 'campaign-evergreen-last-name';

const DEFAULT_CONFIG = {
  webhookUrl: 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger',
  baseUrl: 'https://justjoin.it/job-offers',
  maxPages: 3,
  budgetMaxRequests: 120,
  crawl4aiEndpoint: 'https://crawl4ai-production-0915.up.railway.app/crawl',
  rateSeconds: 1,
  jobTitle: '',
  city: 'Poland',
  experienceLevel: '',
  testMode: false,
  apolloApiKey: '',
  apolloMaxPeoplePerCompany: 3,
};

const FIELD_DEFS = [
  { key: 'webhookUrl', label: 'n8n Webhook URL', type: 'text' },
  { key: 'baseUrl', label: 'Base URL', type: 'text' },
  { key: 'maxPages', label: 'Max Pages', type: 'number', min: 1 },
  { key: 'budgetMaxRequests', label: 'Budget Max Requests', type: 'number', min: 1 },
  { key: 'crawl4aiEndpoint', label: 'crawl4ai Endpoint', type: 'text' },
  { key: 'rateSeconds', label: 'Rate Seconds', type: 'number', min: 0, step: '0.1' },
  { key: 'jobTitle', label: 'Job Title', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'experienceLevel', label: 'Experience Level', type: 'select', options: ['', 'junior', 'mid', 'senior'] },
  { key: 'testMode', label: 'Test Mode', type: 'checkbox' },
  { key: 'apolloApiKey', label: 'Apollo API Key', type: 'password' },
  { key: 'apolloMaxPeoplePerCompany', label: 'Apollo Max People Per Company', type: 'number', min: 1 },
];

function normalizeConfig(raw = {}) {
  return {
    webhookUrl: String(raw?.webhookUrl ?? DEFAULT_CONFIG.webhookUrl).trim(),
    baseUrl: String(raw?.baseUrl ?? DEFAULT_CONFIG.baseUrl).trim(),
    maxPages: Math.max(1, Number(raw?.maxPages ?? DEFAULT_CONFIG.maxPages) || DEFAULT_CONFIG.maxPages),
    budgetMaxRequests: Math.max(1, Number(raw?.budgetMaxRequests ?? DEFAULT_CONFIG.budgetMaxRequests) || DEFAULT_CONFIG.budgetMaxRequests),
    crawl4aiEndpoint: String(raw?.crawl4aiEndpoint ?? DEFAULT_CONFIG.crawl4aiEndpoint).trim(),
    rateSeconds: Math.max(0, Number(raw?.rateSeconds ?? DEFAULT_CONFIG.rateSeconds) || DEFAULT_CONFIG.rateSeconds),
    jobTitle: String(raw?.jobTitle ?? DEFAULT_CONFIG.jobTitle),
    city: String(raw?.city ?? DEFAULT_CONFIG.city),
    experienceLevel: String(raw?.experienceLevel ?? DEFAULT_CONFIG.experienceLevel),
    testMode: Boolean(raw?.testMode),
    apolloApiKey: String(raw?.apolloApiKey ?? DEFAULT_CONFIG.apolloApiKey),
    apolloMaxPeoplePerCompany: Math.max(1, Number(raw?.apolloMaxPeoplePerCompany ?? DEFAULT_CONFIG.apolloMaxPeoplePerCompany) || DEFAULT_CONFIG.apolloMaxPeoplePerCompany),
  };
}

function fromEvergreenRunner(runner = {}) {
  return normalizeConfig({
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
  });
}

export default function CampaignConfigPanel() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [settingsText, setSettingsText] = useState('{"mode":"evergreen","send_interval_min":5}');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('unknown');
  const lastLoadedNameRef = useRef('');

  const normalizedCampaignName = useMemo(() => String(name || DEFAULT_NAME).trim() || DEFAULT_NAME, [name]);
  const normalizedConfig = useMemo(() => normalizeConfig(config), [config]);

  async function refreshStatus(targetName = normalizedCampaignName) {
    try {
      const res = await fetch(`/api/admin/campaign/get-status?name=${encodeURIComponent(targetName)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.found && data?.status) setCurrentStatus(data.status);
      else setCurrentStatus('not_created');
      return data;
    } catch {
      setCurrentStatus('unknown');
      return null;
    }
  }

  function setConfigField(key, value) {
    setConfig((prev) => normalizeConfig({ ...prev, [key]: value }));
  }

  function loadDraftFromLocal(targetName) {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem(`campaign-evergreen-draft:${targetName}`);
      if (!raw) return false;
      setConfig(normalizeConfig(JSON.parse(raw)));
      return true;
    } catch {
      return false;
    }
  }

  async function loadCampaignConfig(targetName = normalizedCampaignName) {
    try {
      const res = await fetch(`/api/admin/campaign/get-status?name=${encodeURIComponent(targetName)}`, { cache: 'no-store' });
      const data = await res.json();
      const evergreen = data?.campaign?.settings?.evergreen_runner || {};
      if (Object.keys(evergreen).length > 0) {
        setConfig(fromEvergreenRunner(evergreen));
        return true;
      }
      return loadDraftFromLocal(targetName);
    } catch {
      return loadDraftFromLocal(targetName);
    }
  }

  useEffect(() => {
    const boot = async () => {
      const storedName = typeof window !== 'undefined' ? (window.localStorage.getItem(LAST_CAMPAIGN_NAME_KEY) || '').trim() : '';
      const initialName = storedName || DEFAULT_NAME;
      setName(initialName);
      lastLoadedNameRef.current = initialName;
      await refreshStatus(initialName);
      await loadCampaignConfig(initialName);
    };
    boot();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_CAMPAIGN_NAME_KEY, normalizedCampaignName);
    window.localStorage.setItem(`campaign-evergreen-draft:${normalizedCampaignName}`, JSON.stringify(normalizedConfig));
  }, [normalizedCampaignName, normalizedConfig]);

  const badgeStyle = useMemo(() => {
    if (currentStatus === 'running') return { background: '#0a7d22', color: '#fff' };
    if (currentStatus === 'paused') return { background: '#8a6d00', color: '#fff' };
    if (currentStatus === 'stopped') return { background: '#a00020', color: '#fff' };
    if (currentStatus === 'not_created') return { background: '#666', color: '#fff' };
    return { background: '#2d2d2d', color: '#fff' };
  }, [currentStatus]);

  const runnerPayload = useMemo(() => ({ campaignName: normalizedCampaignName, ...normalizedConfig }), [normalizedCampaignName, normalizedConfig]);

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
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      setMsg(`OK: ${data?.campaign_id || data?.id || 'done'}`);
      await refreshStatus(body?.name || body?.campaignName || normalizedCampaignName);
      await loadCampaignConfig(body?.name || body?.campaignName || normalizedCampaignName);
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveEvergreenSettings() {
    setLoading(true);
    setMsg('');
    try {
      if (!normalizedConfig.webhookUrl) throw new Error('Webhook URL is empty');
      const res = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runnerPayload),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      const savedConfig = fromEvergreenRunner(data?.evergreen_runner || {});
      setConfig(savedConfig);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`campaign-evergreen-draft:${normalizedCampaignName}`, JSON.stringify(savedConfig));
      }
      setMsg(`OK: saved for ${normalizedCampaignName}`);
      await refreshStatus(normalizedCampaignName);
      await loadCampaignConfig(normalizedCampaignName);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function startEvergreen(mode = 'start') {
    setLoading(true);
    setMsg('');
    try {
      if (!normalizedConfig.webhookUrl) throw new Error('Webhook URL is empty');
      const saveRes = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runnerPayload),
      });
      const saveText = await saveRes.text();
      const saveData = (() => { try { return JSON.parse(saveText); } catch { return { raw: saveText }; } })();
      if (!saveRes.ok) throw new Error(saveData?.error || saveData?.message || saveText || `HTTP ${saveRes.status}`);
      const savedConfig = fromEvergreenRunner(saveData?.evergreen_runner || {});
      setConfig(savedConfig);

      const res = await fetch('/api/admin/campaign/start-evergreen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignName: normalizedCampaignName, ...savedConfig, mode }),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`campaign-evergreen-draft:${normalizedCampaignName}`, JSON.stringify(savedConfig));
      }
      setMsg(mode === 'test' ? 'OK: test webhook sent' : 'OK: campaign started with current saved config');
      await refreshStatus(normalizedCampaignName);
      await loadCampaignConfig(normalizedCampaignName);
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  const fieldRow = { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, alignItems: 'center' };
  const input = { width: '100%' };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Campaign config (test/admin)</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(480px, 760px) 220px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={async (e) => {
                const targetName = String(e.target.value || '').trim() || DEFAULT_NAME;
                if (targetName === lastLoadedNameRef.current) return;
                lastLoadedNameRef.current = targetName;
                await refreshStatus(targetName);
                await loadCampaignConfig(targetName);
              }}
              style={input}
            />
          </label>

          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={input} />
          </label>

          <label>
            Settings JSON
            <textarea rows={4} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} style={input} />
          </label>

          <div style={{ marginTop: 8, padding: 12, border: '1px solid #eee', borderRadius: 8, display: 'grid', gap: 10 }}>
            <b>Dynamic evergreen config</b>
            {FIELD_DEFS.map((field) => {
              const value = normalizedConfig[field.key];
              if (field.type === 'checkbox') {
                return (
                  <label key={field.key} style={fieldRow}>
                    <span>{field.label}</span>
                    <input type="checkbox" checked={Boolean(value)} onChange={(e) => setConfigField(field.key, e.target.checked)} />
                  </label>
                );
              }
              if (field.type === 'select') {
                return (
                  <label key={field.key} style={fieldRow}>
                    <span>{field.label}</span>
                    <select value={value} onChange={(e) => setConfigField(field.key, e.target.value)} style={input}>
                      {field.options.map((opt) => <option key={opt || 'empty'} value={opt}>{opt || 'Any'}</option>)}
                    </select>
                  </label>
                );
              }
              return (
                <label key={field.key} style={fieldRow}>
                  <span>{field.label}</span>
                  <input
                    type={field.type}
                    min={field.min}
                    step={field.step}
                    value={field.type === 'number' ? value : String(value ?? '')}
                    onChange={(e) => setConfigField(field.key, field.type === 'number' ? e.target.value : e.target.value)}
                    spellCheck={field.key === 'webhookUrl' ? false : undefined}
                    autoComplete={field.key === 'webhookUrl' ? 'off' : undefined}
                    style={input}
                  />
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              disabled={loading}
              onClick={async () => {
                let settings = {};
                try { settings = settingsText ? JSON.parse(settingsText) : {}; } catch { setMsg('ERR: settings JSON invalid'); return; }
                await callApi('/api/admin/campaign/create', { name: normalizedCampaignName, description, status: 'running', settings });
              }}
            >
              Create campaign
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/ensure-evergreen', { name: normalizedCampaignName })}>
              Ensure evergreen running
            </button>

            <button disabled={loading} onClick={saveEvergreenSettings}>
              Save config
            </button>

            <button
              disabled={loading}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.localStorage.removeItem(`campaign-evergreen-draft:${normalizedCampaignName}`);
                }
                setConfig(DEFAULT_CONFIG);
                setMsg('OK: local draft cleared');
                lastLoadedNameRef.current = normalizedCampaignName;
              }}
            >
              Clear local draft
            </button>

            <button disabled={loading} onClick={() => startEvergreen('test')}>
              Test webhook
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { name: normalizedCampaignName, status: 'stopped' })}>
              Stop evergreen
            </button>

            <button disabled={loading} onClick={() => startEvergreen('start')}>
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
          <div style={{ marginTop: 12, fontSize: 11, color: '#555' }}>
            Last campaign: <b>{normalizedCampaignName}</b>
          </div>
        </aside>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
