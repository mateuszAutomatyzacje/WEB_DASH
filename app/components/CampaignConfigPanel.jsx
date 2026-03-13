'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const STATUSES = ['draft', 'ready', 'running', 'paused', 'stopped', 'archived'];
const DEFAULT_NAME = 'OUTSOURCING_IT_EVERGREEM';
const DEFAULT_WEBHOOK = 'https://n8n-production-c340.up.railway.app/webhook-test/efxblr-test-trigger';

const DEFAULT_RUNNER = {
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

export default function CampaignConfigPanel() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [description, setDescription] = useState('Kampania ciągła dla nowych leadów');
  const [settingsText, setSettingsText] = useState('{"mode":"evergreen","send_interval_min":5}');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('unknown');
  const [webhookUrl, setWebhookUrl] = useState(DEFAULT_WEBHOOK);
  const [runner, setRunner] = useState(DEFAULT_RUNNER);
  const lastLoadedNameRef = useRef('');

  async function refreshStatus(targetName = name) {
    try {
      const res = await fetch(`/api/admin/campaign/get-status?name=${encodeURIComponent(targetName)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.found && data?.status) setCurrentStatus(data.status);
      else setCurrentStatus('not_created');
    } catch {
      setCurrentStatus('unknown');
    }
  }

  function loadDraftFromLocal(targetName) {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem(`campaign-evergreen-draft:${targetName}`);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      setWebhookUrl(draft?.webhookUrl || DEFAULT_WEBHOOK);
      setRunner({
        baseUrl: draft?.baseUrl || DEFAULT_RUNNER.baseUrl,
        maxPages: Number(draft?.maxPages || DEFAULT_RUNNER.maxPages),
        budgetMaxRequests: Number(draft?.budgetMaxRequests || DEFAULT_RUNNER.budgetMaxRequests),
        crawl4aiEndpoint: draft?.crawl4aiEndpoint || DEFAULT_RUNNER.crawl4aiEndpoint,
        rateSeconds: Number(draft?.rateSeconds || DEFAULT_RUNNER.rateSeconds),
        jobTitle: draft?.jobTitle || DEFAULT_RUNNER.jobTitle,
        city: draft?.city || DEFAULT_RUNNER.city,
        experienceLevel: draft?.experienceLevel || DEFAULT_RUNNER.experienceLevel,
        testMode: Boolean(draft?.testMode),
        apolloApiKey: draft?.apolloApiKey || DEFAULT_RUNNER.apolloApiKey,
        apolloMaxPeoplePerCompany: Number(draft?.apolloMaxPeoplePerCompany || DEFAULT_RUNNER.apolloMaxPeoplePerCompany),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function loadCampaignConfig(targetName = name) {
    try {
      const res = await fetch(`/api/admin/campaign/get-status?name=${encodeURIComponent(targetName)}`, { cache: 'no-store' });
      const data = await res.json();
      const evergreen = data?.campaign?.settings?.evergreen_runner || {};
      if (Object.keys(evergreen).length > 0) {
        setWebhookUrl(evergreen?.webhook_url || DEFAULT_WEBHOOK);
        setRunner({
          baseUrl: evergreen?.base_url || DEFAULT_RUNNER.baseUrl,
          maxPages: Number(evergreen?.max_pages || DEFAULT_RUNNER.maxPages),
          budgetMaxRequests: Number(evergreen?.budget_max_requests || DEFAULT_RUNNER.budgetMaxRequests),
          crawl4aiEndpoint: evergreen?.crawl4ai_endpoint || DEFAULT_RUNNER.crawl4aiEndpoint,
          rateSeconds: Number(evergreen?.rate_seconds || DEFAULT_RUNNER.rateSeconds),
          jobTitle: evergreen?.job_title || DEFAULT_RUNNER.jobTitle,
          city: evergreen?.city || DEFAULT_RUNNER.city,
          experienceLevel: evergreen?.experience_level || DEFAULT_RUNNER.experienceLevel,
          testMode: Boolean(evergreen?.test_mode),
          apolloApiKey: evergreen?.apollo_api_key || DEFAULT_RUNNER.apolloApiKey,
          apolloMaxPeoplePerCompany: Number(evergreen?.apollo_max_people_per_company || DEFAULT_RUNNER.apolloMaxPeoplePerCompany),
        });
        return;
      }
      loadDraftFromLocal(targetName);
    } catch {
      loadDraftFromLocal(targetName);
    }
  }

  useEffect(() => {
    refreshStatus();
    loadCampaignConfig();
    lastLoadedNameRef.current = DEFAULT_NAME;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`campaign-evergreen-draft:${normalizedCampaignName}`, JSON.stringify({
      webhookUrl: normalizedWebhookUrl,
      ...runner,
    }));
  }, [normalizedCampaignName, normalizedWebhookUrl, runner]);

  const badgeStyle = useMemo(() => {
    if (currentStatus === 'running') return { background: '#0a7d22', color: '#fff' };
    if (currentStatus === 'paused') return { background: '#8a6d00', color: '#fff' };
    if (currentStatus === 'stopped') return { background: '#a00020', color: '#fff' };
    if (currentStatus === 'not_created') return { background: '#666', color: '#fff' };
    return { background: '#2d2d2d', color: '#fff' };
  }, [currentStatus]);

  const normalizedCampaignName = useMemo(() => String(name || DEFAULT_NAME).trim() || DEFAULT_NAME, [name]);
  const normalizedWebhookUrl = useMemo(() => String(webhookUrl || '').trim(), [webhookUrl]);

  const runnerPayload = useMemo(() => ({
    campaignName: normalizedCampaignName,
    webhookUrl: normalizedWebhookUrl,
    baseUrl: String(runner.baseUrl || '').trim(),
    maxPages: Number(runner.maxPages || 3),
    budgetMaxRequests: Number(runner.budgetMaxRequests || 120),
    crawl4aiEndpoint: String(runner.crawl4aiEndpoint || '').trim(),
    rateSeconds: Number(runner.rateSeconds || 1),
    jobTitle: String(runner.jobTitle || ''),
    city: String(runner.city || ''),
    experienceLevel: String(runner.experienceLevel || ''),
    testMode: Boolean(runner.testMode),
    apolloApiKey: String(runner.apolloApiKey || ''),
    apolloMaxPeoplePerCompany: Number(runner.apolloMaxPeoplePerCompany || 3),
  }), [normalizedCampaignName, normalizedWebhookUrl, runner]);

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
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      setMsg(`OK: ${data?.campaign_id || data?.id || 'done'}`);
      await refreshStatus(body?.name || body?.campaignName || name);
      await loadCampaignConfig(body?.name || body?.campaignName || name);
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
      if (!normalizedWebhookUrl) throw new Error('Webhook URL is empty');
      const res = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runnerPayload),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      setWebhookUrl(data?.evergreen_runner?.webhook_url || normalizedWebhookUrl);
      setMsg(`OK: evergreen settings saved (${data?.evergreen_runner?.webhook_url || normalizedWebhookUrl})`);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`campaign-evergreen-draft:${normalizedCampaignName}`);
      }
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
      if (!normalizedWebhookUrl) throw new Error('Webhook URL is empty');
      const saveRes = await fetch('/api/admin/campaign/evergreen-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runnerPayload),
      });
      const saveText = await saveRes.text();
      const saveData = (() => { try { return JSON.parse(saveText); } catch { return { raw: saveText }; } })();
      if (!saveRes.ok) throw new Error(saveData?.error || saveData?.message || saveText || `HTTP ${saveRes.status}`);
      setWebhookUrl(saveData?.evergreen_runner?.webhook_url || normalizedWebhookUrl);

      const res = await fetch('/api/admin/campaign/start-evergreen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...runnerPayload, webhookUrl: saveData?.evergreen_runner?.webhook_url || normalizedWebhookUrl, mode }),
      });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
      if (!res.ok) throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
      setMsg(mode === 'test' ? 'OK: test webhook sent' : 'OK: campaign started with current evergreen vars');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`campaign-evergreen-draft:${normalizedCampaignName}`);
      }
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
            <b>Evergreen variables used on campaign start</b>

            <label style={fieldRow}><span>webhookUrl</span><input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} spellCheck={false} autoComplete="off" style={input} /></label>
            <label style={fieldRow}><span>baseUrl</span><input value={runner.baseUrl} onChange={(e) => setRunner((r) => ({ ...r, baseUrl: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>maxPages</span><input type="number" min={1} value={runner.maxPages} onChange={(e) => setRunner((r) => ({ ...r, maxPages: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>budgetMaxRequests</span><input type="number" min={1} value={runner.budgetMaxRequests} onChange={(e) => setRunner((r) => ({ ...r, budgetMaxRequests: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>crawl4aiEndpoint</span><input value={runner.crawl4aiEndpoint} onChange={(e) => setRunner((r) => ({ ...r, crawl4aiEndpoint: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>rateSeconds</span><input type="number" step="0.1" min={0} value={runner.rateSeconds} onChange={(e) => setRunner((r) => ({ ...r, rateSeconds: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>jobTitle</span><input value={runner.jobTitle} onChange={(e) => setRunner((r) => ({ ...r, jobTitle: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>city</span><input value={runner.city} onChange={(e) => setRunner((r) => ({ ...r, city: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>experienceLevel</span>
              <select value={runner.experienceLevel} onChange={(e) => setRunner((r) => ({ ...r, experienceLevel: e.target.value }))} style={input}>
                <option value="">Any</option>
                <option value="junior">junior</option>
                <option value="mid">mid</option>
                <option value="senior">senior</option>
              </select>
            </label>
            <label style={fieldRow}><span>testMode</span><input type="checkbox" checked={Boolean(runner.testMode)} onChange={(e) => setRunner((r) => ({ ...r, testMode: e.target.checked }))} /></label>
            <label style={fieldRow}><span>apolloApiKey</span><input type="password" value={runner.apolloApiKey} onChange={(e) => setRunner((r) => ({ ...r, apolloApiKey: e.target.value }))} style={input} /></label>
            <label style={fieldRow}><span>apolloMaxPeoplePerCompany</span><input type="number" min={1} value={runner.apolloMaxPeoplePerCompany} onChange={(e) => setRunner((r) => ({ ...r, apolloMaxPeoplePerCompany: e.target.value }))} style={input} /></label>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              disabled={loading}
              onClick={async () => {
                let settings = {};
                try { settings = settingsText ? JSON.parse(settingsText) : {}; } catch { setMsg('ERR: settings JSON invalid'); return; }
                await callApi('/api/admin/campaign/create', { name, description, status: 'running', settings });
              }}
            >
              Create campaign
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/ensure-evergreen', { name })}>
              Ensure evergreen running
            </button>

            <button disabled={loading} onClick={saveEvergreenSettings}>
              Save evergreen vars
            </button>

            <button
              disabled={loading}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.localStorage.removeItem(`campaign-evergreen-draft:${normalizedCampaignName}`);
                }
                setWebhookUrl(DEFAULT_WEBHOOK);
                setRunner(DEFAULT_RUNNER);
                setMsg('OK: local draft cleared');
              }}
            >
              Clear local draft
            </button>

            <button disabled={loading} onClick={() => startEvergreen('test')}>
              Test webhook
            </button>

            <button disabled={loading} onClick={() => callApi('/api/admin/campaign/evergreen-status', { name, status: 'stopped' })}>
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
        </aside>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
