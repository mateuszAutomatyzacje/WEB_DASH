'use client';

import { useState } from 'react';

export default function CampaignConfigPanel() {
  const [name, setName] = useState('AI_KANCELARIE_EVERGREEN');
  const [description, setDescription] = useState('Kampania ciągła dla nowych leadów');
  const [status, setStatus] = useState('running');
  const [settingsText, setSettingsText] = useState('{"mode":"evergreen","send_interval_min":5}');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

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
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setMsg(`ERR: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Campaign config (test/admin)</h3>

      <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </label>

        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
        </label>

        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">draft</option>
            <option value="ready">ready</option>
            <option value="running">running</option>
            <option value="paused">paused</option>
            <option value="stopped">stopped</option>
            <option value="archived">archived</option>
          </select>
        </label>

        <label>
          Settings JSON
          <textarea rows={4} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} style={{ width: '100%' }} />
        </label>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          disabled={loading}
          onClick={async () => {
            let settings = {};
            try { settings = settingsText ? JSON.parse(settingsText) : {}; } catch { setMsg('ERR: settings JSON invalid'); return; }
            await callApi('/api/admin/campaign/create', { name, description, status, settings });
          }}
        >
          Create campaign
        </button>

        <button
          disabled={loading}
          onClick={() => callApi('/api/admin/campaign/ensure-evergreen', { name })}
        >
          Ensure evergreen running
        </button>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </div>
  );
}
