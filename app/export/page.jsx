import { AppShell, Card, Field, FilterForm, FiltersGrid, StatCard, Table, inputStyle, td, th } from '@/app/components/AppShell.jsx';
import { getSql } from '@/lib/db.js';
import { formatDateTime } from '@/lib/time.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import {
  buildLeadExportQueryString,
  EXPORT_EMAIL_OPTIONS,
  EXPORT_SCOPE_OPTIONS,
  EXPORT_UPDATED_OPTIONS,
  getLeadExportScopeLabel,
  getLeadExportUpdatedLabel,
  getLeadExportStats,
  listLeadExportCampaignOptions,
  listLeadExportRows,
  normalizeLeadExportFilters,
} from '@/lib/lead-export.js';

export const dynamic = 'force-dynamic';

const PREVIEW_LIMIT = 100;
const EXPORT_LIMIT = 5000;

export default async function ExportPage({ searchParams }) {
  const sql = getSql();
  const resolvedSearchParams = await searchParams;

  const campaignOptions = await listLeadExportCampaignOptions(sql);
  const defaultCampaign = campaignOptions.find((row) => row.name === DEFAULT_EVERGREEN_NAME) || null;
  const filters = normalizeLeadExportFilters(resolvedSearchParams, {
    defaultCampaignId: defaultCampaign?.id || 'all',
    defaultLimit: PREVIEW_LIMIT,
  });

  const [stats, rows] = await Promise.all([
    getLeadExportStats(sql, filters),
    listLeadExportRows(sql, filters, { limit: PREVIEW_LIMIT }),
  ]);

  const selectedCampaign = campaignOptions.find((row) => row.id === filters.campaign_id) || null;
  const selectedCampaignLabel = filters.campaign_id === 'all'
    ? 'All campaigns'
    : (selectedCampaign?.name || filters.campaign_id);
  const downloadQuery = buildLeadExportQueryString(filters, { format: 'csv', limit: EXPORT_LIMIT });
  const xlsQuery = buildLeadExportQueryString(filters, { format: 'xls', limit: EXPORT_LIMIT });
  const jsonQuery = buildLeadExportQueryString(filters, { format: 'json', limit: EXPORT_LIMIT });
  const jsonFeedUrl = `/api/export/leads?${jsonQuery}`;

  return (
    <AppShell
      title="Export"
      subtitle="Live eksport kontaktow z leadami: imie, nazwisko, email, LinkedIn i informacja jakiego developera szuka firma. Ten sam filtr zasila preview oraz CSV/XLS/JSON do automatyzacji."
      actions={(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`/api/export/leads?${downloadQuery}`} style={{ color: '#93c5fd' }}>Download CSV</a>
          <a href={`/api/export/leads?${xlsQuery}`} style={{ color: '#93c5fd' }}>Download XLS</a>
          <a href={jsonFeedUrl} style={{ color: '#93c5fd' }}>Open JSON feed</a>
        </div>
      )}
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard label="Matching rows" value={stats.total ?? 0} helper={`${getLeadExportScopeLabel(filters.scope)} · ${selectedCampaignLabel}`} />
        <StatCard label="With email" value={stats.with_email ?? 0} tone="success" helper={filters.email === 'with_email' ? 'email filter active' : 'all contacts mode'} />
        <StatCard label="With LinkedIn" value={stats.with_linkedin ?? 0} helper="contact or lead LinkedIn URL" />
        <StatCard label="With dev need" value={stats.with_job_title ?? 0} helper="lead.job_title" />
        <StatCard label="In campaign" value={stats.in_campaign ?? 0} helper={getLeadExportUpdatedLabel(filters.updated)} />
      </section>

      <FilterForm>
        <FiltersGrid>
          <Field label="Campaign">
            <select name="campaign_id" defaultValue={filters.campaign_id} style={inputStyle}>
              <option value="all">All campaigns</option>
              {campaignOptions.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.status})</option>
              ))}
            </select>
          </Field>
          <Field label="Scope">
            <select name="scope" defaultValue={filters.scope} style={inputStyle}>
              {EXPORT_SCOPE_OPTIONS.map((scope) => (
                <option key={scope} value={scope}>{getLeadExportScopeLabel(scope)}</option>
              ))}
            </select>
          </Field>
          <Field label="Email filter">
            <select name="email" defaultValue={filters.email} style={inputStyle}>
              {EXPORT_EMAIL_OPTIONS.map((emailMode) => (
                <option key={emailMode} value={emailMode}>{emailMode}</option>
              ))}
            </select>
          </Field>
          <Field label="Updated window">
            <select name="updated" defaultValue={filters.updated} style={inputStyle}>
              {EXPORT_UPDATED_OPTIONS.map((updated) => (
                <option key={updated} value={updated}>{getLeadExportUpdatedLabel(updated)}</option>
              ))}
            </select>
          </Field>
          <Field label="Run filters">
            <button type="submit" style={{ ...inputStyle, cursor: 'pointer', fontWeight: 700 }}>Apply filters</button>
          </Field>
        </FiltersGrid>
      </FilterForm>

      <section style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Export actions</h2>
          <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.7, marginBottom: 14 }}>
            Preview pokazuje pierwsze <b>{PREVIEW_LIMIT}</b> rekordow na zywo z DB. Download i JSON feed biora ten sam filtr, ale zwracaja do <b>{EXPORT_LIMIT}</b> rekordow w jednym eksporcie.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <a href={`/api/export/leads?${downloadQuery}`} style={{ ...inputStyle, width: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Download CSV</a>
            <a href={`/api/export/leads?${xlsQuery}`} style={{ ...inputStyle, width: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Download XLS</a>
            <a href={jsonFeedUrl} style={{ ...inputStyle, width: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Open JSON feed</a>
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>Automation feed URL</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 12, margin: 0, fontSize: 12, color: '#e2e8f0' }}>
            {jsonFeedUrl}
          </pre>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Current export scope</h2>
          <Table>
            <tbody>
              <tr><td style={td}>Campaign</td><td style={td}>{selectedCampaignLabel}</td></tr>
              <tr><td style={td}>Scope</td><td style={td}>{getLeadExportScopeLabel(filters.scope)}</td></tr>
              <tr><td style={td}>Email filter</td><td style={td}>{filters.email}</td></tr>
              <tr><td style={td}>Updated window</td><td style={td}>{getLeadExportUpdatedLabel(filters.updated)}</td></tr>
              <tr><td style={td}>Rows now</td><td style={td}>{stats.total ?? 0}</td></tr>
              <tr><td style={td}>Preview size</td><td style={td}>{rows.length}</td></tr>
            </tbody>
          </Table>
        </Card>
      </section>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Export preview</h2>
            <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 13 }}>
              Najnowszy snapshot do eksportu: firma, kontakt, LinkedIn oraz job title z ogloszenia.
            </div>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Generated {formatDateTime(new Date().toISOString())}
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <th style={th}>company</th>
              <th style={th}>developer needed</th>
              <th style={th}>contact</th>
              <th style={th}>linkedin</th>
              <th style={th}>campaign</th>
              <th style={th}>state</th>
              <th style={th}>next run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.lead_id}-${row.lead_contact_id}`}>
                <td style={td}>
                  <div>{row.company_name || '-'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{row.domain || row.website_url || '-'}</div>
                </td>
                <td style={td}>
                  <div>{row.developer_needed || '-'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{row.job_url || '-'}</div>
                </td>
                <td style={td}>
                  <div>{[row.first_name, row.last_name].filter(Boolean).join(' ') || '-'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{row.email || '-'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{row.contact_title || row.seniority || '-'}</div>
                </td>
                <td style={td}>
                  {row.linkedin_url ? <a href={row.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{row.linkedin_url}</a> : '-'}
                </td>
                <td style={td}>{row.campaign_name || '-'}</td>
                <td style={td}>{row.campaign_state || '-'}</td>
                <td style={td}>{formatDateTime(row.next_run_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={td} colSpan={7}>No rows for current export filters</td></tr>}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  );
}
