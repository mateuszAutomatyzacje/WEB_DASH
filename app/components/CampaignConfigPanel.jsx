'use client';

import { useRouter } from 'next/navigation';
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
  sendIntervalMin: 5,
};

const FIELD_DEFS = [
  { key: 'sendIntervalMin', label: 'Send interval', type: 'select', options: [5, 10, 15] },
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
  const sendIntervalMin = Number(raw?.sendIntervalMin ?? raw?.send_interval_min ?? DEFAULT_CONFIG.sendIntervalMin);
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
    sendIntervalMin: [5, 10, 15].includes(sendIntervalMin) ? sendIntervalMin : DEFAULT_CONFIG.sendIntervalMin,
  };
}

function fromCampaign(campaign) {
  const settings = campaign?.settings || {};
  const runner = settings?.evergreen_runner || {};
  return {
    description: campaign?.description || DEFAULT_DESCRIPTION,
    config: normalizeConfig({
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
      sendIntervalMin: settings?.send_interval_min,
    }),
    settingsText: JSON.stringify({
      mode: settings?.mode || 'evergreen',
      send_interval_min: Number(settings?.send_interval_min || 5),
      auto_enqueue: settings?.auto_enqueue ?? true,
      auto_sync_enabled: settings?.auto_sync_enabled ?? true,
      sync_interval_min: Number(settings?.sync_interval_min || 10),
      auto_sync_status: settings?.auto_sync_status || 'running',
    }, null, 2),
  };
}

export default function CampaignConfigPanel({ initialCampaignId = '', initialCampaignName = DEFAULT_NAME }) {
  const [campaignId, setCampaignId] = useState('');
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [name, setName] = useState(DEFAULT_NAME);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [settingsText, setSettingsText] = useState('');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('unknown');
  const [dbSnapshot, setDbSnapshot] = useState(null);
  const lastLoadedNameRef = useRef('');
  const router = useRouter();

  const normalizedCampaignName = useMemo(() => String(name || DEFAULT_NAME).trim() || DEFAULT_NAME, [name]);
  const normalizedConfig = useMemo(() => normalizeConfig(config), [config]);

  async function fetchCampaign({ id = '', name: targetName = normalizedCampaignName } = {}) {
    const qs = id
      ? `campaignId=${encodeURIComponent(id)}`
      : `name=${encodeURIComponent(targetName)}`;
    const res = await fetch(`/api/admin/campaign/get-status?${qs}`, { cache: 'no-store' });
    return res.json();
  }

  async function loadFromDb({ id = '', name: targetName = normalizedCampaignName } = {}) {
    try {
      const data = await fetchCampaign({ id, name: targetName });
      if (!data?.found || !data?.campaign) {
        setCampaignId('');
        setDuplicateCount(0);
        setDbSnapshot(null);
        setCurrentStatus('not_created');
        setDescription(DEFAULT_DESCRIPTION);
        setConfig(DEFAULT_CONFIG);
        setSettingsText(JSON.stringify({ mode: 'evergreen', send_interval_min: 5 }, null, 2));
        return false;
      }
      const campaign = data.campaign;
      const loaded = fromCampaign(campaign);
      setCampaignId(String(campaign.id || ''));
      setName(campaign.name || targetName || DEFAULT_NAME);
      setDuplicateCount(Number(data?.duplicate_count_for_name || 1));
      setCurrentStatus(data.status || campaign.status || 'unknown');
      setDescription(loaded.description);
      setConfig(loaded.config);
      setSettingsText(loaded.settingsText);
      setDbSnapshot({
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        status: campaign.status,
        updated_at: campaign.updated_at,
        send_interval_min: campaign?.settings?.send_interval_min,
        evergreen_runner: campaign?.settings?.evergreen_runner || null,
      });
      lastLoadedNameRef.current = campaign.name || targetName || DEFAULT_NAME;
      return true;
    } catch {
      setCurrentStatus('unknown');
      return false;
    }
  }

  function setConfigField(key, value) {
    setConfig((prev) => normalizeConfig({ ...prev, [key]: value }));
  }

  useEffect(() => {
    const boot = async () => {
      const storedName = typeof window !== 'undefined' ? (window.localStorage.getItem(LAST_CAMPAIGN_NAME_KEY) || '').trim() : '';
      const preferredName = storedName || initialCampaignName || DEFAULT_NAME;
      setName(preferredName);
      lastLoadedNameRef.current = preferredName;
      if (initialCampaignId) {
        const ok = await loadFromDb({ id: initialCampaignId, name: preferredName });
        if (ok) return;
      }
      await loadFromDb({ name: preferredName });
    };
    boot();
  }, [initialCampaignId, initialCampaignName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_CAMPAIGN_NAME_KEY, normalizedCampaignName);
  }, [normalizedCampaignName]);

  const badgeStyle = useMemo(() => {
    if (currentStatus === 'running') return { background: '#0a7d22', color: '#fff' };
    if (currentStatus === 'paused') return { background: '#8a6d00', color: '#fff' };
    if (currentStatus === 'stopped') return { background: '#a00020', color: '#fff' };
    if (currentStatus === 'not_created') return { background: '#666', color: '#fff' };
    return { background: '#2d2d2d', color: '#fff' };
  }, [currentStatus]);

  const runnerPayload = useMemo(() => ({
    campaign_id: campaignId || undefined,
    campaignId: campaignId || undefined,
    campaignName: normalizedCampaignName,
    ...normalizedConfig,
  }), [campaignId, normalizedCampaignName, normalizedConfig]);

  async function callApi(path, body, { reload = true } = {}) {
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
      if (reload) await loadFromDb({ id: String(data?.id || data?.campaign_id || body?.campaign_id || campaignId || ''), name: body?.name || body?.campaignName || normalizedCampaignName });
      setMsg(`OK: ${data?.campaign_id || data?.id || 'done'}`);
      return data;
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function saveCampaignConfig() {
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
      await loadFromDb({ id: String(data?.campaign_id || campaignId || ''), name: normalizedCampaignName });
      router.refresh();
      setMsg(`OK: saved for ${normalizedCampaignName}`);
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
      const saveRes = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runnerPayload),
      });
      const saveText = await saveRes.text();
      const saveData = (() => { try { return JSON.parse(saveText); } catch { return { raw: saveText }; } })();
      if (!saveRes.ok) throw new Error(saveData?.error || saveData?.message || saveText || `HTTP ${saveRes.status}`);

      const res = await fetch('/api/admin/campaign/start-evergreen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...runnerPayload, campaign_id: String(saveData?.campaign_id || campaignId || ''), mode }),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      await loadFromDb({ id: String(data?.campaign_id || campaignId || ''), name: normalizedCampaignName });
      router.refresh();
      setMsg(mode === 'test' ? 'OK: test webhook sent' : 'OK: campaign started with current saved config');
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
      <h3 style={{ marginTop: 0 }}>Campaign config</h3>

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
                await loadFromDb({ name: targetName });
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
            <textarea rows={6} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} style={input} />
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
                    <select value={value} onChange={(e) => setConfigField(field.key, field.key === 'sendIntervalMin' ? Number(e.target.value) : e.target.value)} style={input}>
                      {field.options.map((opt) => <option key={String(opt) || 'empty'} value={opt}>{field.key === 'sendIntervalMin' ? `${opt} min` : (opt || 'Any')}</option>)}
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
                settings = {
                  ...settings,
                  mode: 'evergreen',
                  send_interval_min: normalizedConfig.sendIntervalMin,
                };
                await callApi('/api/admin/campaign/create', {
                  campaign_id: campaignId || undefined,
                  name: normalizedCampaignName,
                  description,
                  status: 'running',
                  settings,
                });
              }}
            >
              Save campaign
            </button>

            <button disabled={loading} onClick={saveCampaignConfig}>
              Save dynamic config
            </button>

            <button disabled={loading} onClick={() => loadFromDb({ id: campaignId, name: normalizedCampaignName })}>
              Reload from DB
            </button>

            <button disabled={loading} onClick={() => startEvergreen('test')}>
              Test webhook
            </button>

            <button disabled={loading} onClick={() => startEvergreen('start')}>
              Start evergreen
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { campaign_id: campaignId || undefined, name: normalizedCampaignName, status: 'stopped' })}>
              Stop evergreen
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
            Campaign ID: <b>{campaignId || '—'}</b>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: duplicateCount > 1 ? '#b00020' : '#555' }}>
            Matching rows by name: <b>{duplicateCount || 0}</b>
          </div>
          {duplicateCount > 1 ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#b00020' }}>
              Uwaga: są duplikaty tej kampanii po name. Panel zapisuje teraz po konkretnym <b>campaign_id</b>.
            </div>
          ) : null}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer' }}>DB snapshot</summary>
            <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, background: '#f8f8f8', padding: 8, borderRadius: 6 }}>
              {JSON.stringify(dbSnapshot, null, 2)}
            </pre>
          </details>
        </aside>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
