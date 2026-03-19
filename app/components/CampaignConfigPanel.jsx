'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EVERGREEN_NAME,
  SEND_INTERVAL_OPTIONS,
  buildEditableCampaignSettings,
  getCampaignRunnerConfig,
  normalizeEvergreenConfig,
} from '@/lib/evergreen-config.js';

const STATUSES = ['draft', 'ready', 'running', 'paused', 'stopped', 'archived', 'test'];
const DEFAULT_DESCRIPTION = 'Kampania ciagla dla nowych leadow';

const FIELD_DEFS = [
  { key: 'sendIntervalMin', label: 'Send interval', type: 'select', options: SEND_INTERVAL_OPTIONS },
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

function parseApiResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function fromCampaign(campaign) {
  return {
    description: campaign?.description || DEFAULT_DESCRIPTION,
    config: getCampaignRunnerConfig(campaign),
    settingsText: JSON.stringify(buildEditableCampaignSettings(campaign?.settings || {}), null, 2),
  };
}

export default function CampaignConfigPanel({ initialCampaignId = '', initialCampaignName = DEFAULT_EVERGREEN_NAME }) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState(String(initialCampaignId || ''));
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [name, setName] = useState(initialCampaignName || DEFAULT_EVERGREEN_NAME);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [settingsText, setSettingsText] = useState('');
  const [config, setConfig] = useState(() => normalizeEvergreenConfig({}, {}, { strict: true }));
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('unknown');
  const [displayStatus, setDisplayStatus] = useState('unknown');
  const [dbSnapshot, setDbSnapshot] = useState(null);

  const normalizedCampaignName = useMemo(
    () => String(name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME,
    [name],
  );
  const normalizedConfig = useMemo(() => normalizeEvergreenConfig(config, {}, { strict: true }), [config]);

  async function fetchCampaign(id) {
    const res = await fetch(`/api/admin/campaign/get-status?campaignId=${encodeURIComponent(id)}`, { cache: 'no-store' });
    return res.json();
  }

  function applyCampaignState(campaign, { duplicateCount: nextDuplicateCount, displayStatus: nextDisplayStatus } = {}) {
    if (!campaign) return false;
    const loaded = fromCampaign(campaign);
    setCampaignId(String(campaign.id || ''));
    setName(campaign.name || DEFAULT_EVERGREEN_NAME);
    if (typeof nextDuplicateCount === 'number') setDuplicateCount(nextDuplicateCount);
    setCurrentStatus(campaign.status || 'unknown');
    setDisplayStatus(nextDisplayStatus || campaign.status || 'unknown');
    setDescription(loaded.description);
    setConfig(loaded.config);
    setSettingsText(loaded.settingsText);
    setDbSnapshot({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      updated_at: campaign.updated_at,
      settings: campaign.settings || {},
    });
    return true;
  }

  async function loadFromDb(id = campaignId) {
    if (!id) return false;
    try {
      const data = await fetchCampaign(id);
      if (!data?.found || !data?.campaign) {
        setDbSnapshot(null);
        setCurrentStatus('not_created');
        return false;
      }
      return applyCampaignState(data.campaign, {
        duplicateCount: Number(data?.duplicate_count_for_name || 1),
      });
    } catch {
      setCurrentStatus('unknown');
      return false;
    }
  }

  useEffect(() => {
    if (initialCampaignId) loadFromDb(String(initialCampaignId));
  }, [initialCampaignId]);

  function setConfigField(key, value) {
    setConfig((prev) => normalizeEvergreenConfig({ ...prev, [key]: value }, {}, { strict: true }));
  }

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
      const data = parseApiResponse(text);
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      if (data?.campaign) {
        applyCampaignState(data.campaign, { duplicateCount, displayStatus: data?.display_status });
      } else if (reload) {
        await loadFromDb(String(data?.id || data?.campaign_id || body?.campaign_id || campaignId || ''));
      }
      setMsg(`OK: ${data?.campaign_id || data?.id || 'done'}`);
      return data;
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function saveCampaign() {
    let settings = {};
    try {
      settings = settingsText ? JSON.parse(settingsText) : {};
    } catch {
      setMsg('ERR: settings JSON invalid');
      return;
    }

    await callApi('/api/admin/campaign/create', {
      campaign_id: campaignId,
      name: normalizedCampaignName,
      description,
      status: 'running',
      settings: buildEditableCampaignSettings(settings),
    });
    router.refresh();
  }

  async function saveDynamicConfig() {
    setLoading(true);
    setMsg('');
    try {
      if (!campaignId) throw new Error('missing campaign_id');
      if (!normalizedConfig.webhookUrl) throw new Error('Webhook URL is empty');
      const res = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, campaignName: normalizedCampaignName, ...normalizedConfig }),
      });
      const text = await res.text();
      const data = parseApiResponse(text);
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      applyCampaignState(data?.campaign, { duplicateCount });
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
      if (!campaignId) throw new Error('missing campaign_id');

      const saveRes = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, campaignName: normalizedCampaignName, ...normalizedConfig }),
      });
      const saveText = await saveRes.text();
      const saveData = parseApiResponse(saveText);
      if (!saveRes.ok) throw new Error(saveData?.error || saveData?.message || saveText || `HTTP ${saveRes.status}`);
      applyCampaignState(saveData?.campaign, { duplicateCount });

      const res = await fetch('/api/admin/campaign/start-evergreen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: saveData?.campaign_id || campaignId,
          campaignName: normalizedCampaignName,
          mode,
        }),
      });
      const text = await res.text();
      const data = parseApiResponse(text);
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      applyCampaignState(data?.campaign, { duplicateCount, displayStatus: data?.display_status });
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
  const effectiveStatus = displayStatus || currentStatus;
  const badgeStyle = effectiveStatus === 'running'
    ? { background: '#0a7d22', color: '#fff' }
    : effectiveStatus === 'paused'
      ? { background: '#8a6d00', color: '#fff' }
      : effectiveStatus === 'stopped'
        ? { background: '#a00020', color: '#fff' }
        : effectiveStatus === 'test'
          ? { background: '#1d4ed8', color: '#fff' }
        : { background: '#2d2d2d', color: '#fff' };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Campaign config</h3>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
        Ten formularz operuje na jednym, przypietym rekordzie kampanii w DB.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(480px, 760px) 220px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            Campaign name
            <input value={name} readOnly style={{ ...input, background: '#f5f5f5' }} />
          </label>

          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={input} />
          </label>

          <label>
            Settings JSON
            <textarea rows={6} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} style={input} />
          </label>
          <div style={{ fontSize: 12, color: '#555' }}>
            This JSON edits only top-level campaign settings. Runner and webhook payload are controlled below. Optional keys:
            <code> follow_up_1_delay_days </code>, <code> follow_up_2_delay_days </code>, <code> send_batch_limit </code>.
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>
            <code>send_interval_min</code> controls the evergreen scheduler and scraper cadence for this campaign.
          </div>

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
                    style={input}
                  />
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={loading} onClick={saveCampaign}>Save campaign</button>
            <button disabled={loading} onClick={saveDynamicConfig}>Save dynamic config</button>
            <button disabled={loading} onClick={() => loadFromDb(campaignId)}>Reload from DB</button>
            <button disabled={loading} onClick={() => startEvergreen('test')}>Test webhook</button>
            <button disabled={loading} onClick={() => startEvergreen('start')}>Start evergreen</button>
            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { campaign_id: campaignId, status: 'stopped' })}>Stop evergreen</button>
          </div>
        </div>

        <aside style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, fontSize: 12 }}>
          <b>Statusy kampanii</b>
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-block', borderRadius: 999, padding: '3px 10px', fontSize: 12, ...badgeStyle }}>
              current: {effectiveStatus}
            </span>
          </div>
          {effectiveStatus !== currentStatus ? (
            <div style={{ marginBottom: 8, fontSize: 11, color: '#555' }}>
              Campaign DB status: <b>{currentStatus}</b>
            </div>
          ) : null}
          <ul style={{ margin: '8px 0 0 16px', padding: 0, lineHeight: 1.7 }}>
            {STATUSES.map((s) => (
              <li key={s} style={s === effectiveStatus ? { fontWeight: 700, color: s === 'test' ? '#1d4ed8' : '#0a7d22' } : undefined}>{s}</li>
            ))}
          </ul>
          <div style={{ marginTop: 12, fontSize: 11, color: '#555' }}>Campaign ID: <b>{campaignId || '-'}</b></div>
          <div style={{ marginTop: 8, fontSize: 11, color: duplicateCount > 1 ? '#b00020' : '#555' }}>Matching rows by name: <b>{duplicateCount || 0}</b></div>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer' }}>DB snapshot</summary>
            <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, background: '#f8f8f8', color: '#000', padding: 8, borderRadius: 6 }}>
              {JSON.stringify(dbSnapshot, null, 2)}
            </pre>
          </details>
        </aside>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
