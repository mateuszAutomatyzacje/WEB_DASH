export const EXPORT_SCOPE_OPTIONS = ['campaign_contacts', 'sendable_now', 'all_contacts'];
export const EXPORT_EMAIL_OPTIONS = ['with_email', 'all'];
export const EXPORT_UPDATED_OPTIONS = ['all', '24h', '7d', '30d'];

const DEFAULT_SCOPE = 'campaign_contacts';
const DEFAULT_EMAIL = 'with_email';
const DEFAULT_UPDATED = 'all';
const DEFAULT_LIMIT = 100;
const MAX_EXPORT_LIMIT = 10000;

function normalizeUuid(value) {
  const raw = String(value || '').trim();
  return /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : 'all';
}

function normalizeInt(value, fallback, { min = 1, max = MAX_EXPORT_LIMIT } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.trunc(numeric), max));
}

function resolveUpdatedInterval(updated) {
  if (updated === '24h') return '24 hours';
  if (updated === '7d') return '7 days';
  if (updated === '30d') return '30 days';
  return null;
}

export function normalizeLeadExportFilters(searchParams, { defaultCampaignId = 'all', defaultLimit = DEFAULT_LIMIT } = {}) {
  const rawCampaignId = searchParams?.campaign_id ?? defaultCampaignId ?? 'all';
  const rawScope = String(searchParams?.scope || DEFAULT_SCOPE).trim();
  const rawEmail = String(searchParams?.email || DEFAULT_EMAIL).trim();
  const rawUpdated = String(searchParams?.updated || DEFAULT_UPDATED).trim();

  return {
    campaign_id: normalizeUuid(rawCampaignId),
    scope: EXPORT_SCOPE_OPTIONS.includes(rawScope) ? rawScope : DEFAULT_SCOPE,
    email: EXPORT_EMAIL_OPTIONS.includes(rawEmail) ? rawEmail : DEFAULT_EMAIL,
    updated: EXPORT_UPDATED_OPTIONS.includes(rawUpdated) ? rawUpdated : DEFAULT_UPDATED,
    limit: normalizeInt(searchParams?.limit, defaultLimit),
  };
}

export async function listLeadExportCampaignOptions(sql) {
  return sql`
    select id, name, status::text as status
    from public.campaigns
    order by updated_at desc, created_at desc
    limit 50
  `;
}

export async function getLeadExportStats(sql, filters) {
  const campaignId = filters?.campaign_id === 'all' ? null : filters?.campaign_id || null;
  const updatedInterval = resolveUpdatedInterval(filters?.updated);
  const scope = filters?.scope || DEFAULT_SCOPE;
  const emailMode = filters?.email || DEFAULT_EMAIL;

  const [row] = await sql`
    with campaign_link as (
      select distinct on (cl.lead_id, cl.active_contact_id)
        cl.lead_id,
        cl.active_contact_id as lead_contact_id,
        cl.campaign_id,
        c.name as campaign_name,
        cl.state::text as campaign_state,
        cl.contact_attempt_no,
        cl.next_run_at,
        cl.updated_at as campaign_updated_at
      from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where (${campaignId}::uuid is null or cl.campaign_id = ${campaignId}::uuid)
      order by cl.lead_id, cl.active_contact_id, cl.updated_at desc
    ), base as (
      select
        l.id as lead_id,
        lc.id as lead_contact_id,
        cl.campaign_id,
        cl.campaign_name,
        cl.campaign_state,
        cl.contact_attempt_no,
        cl.next_run_at,
        l.company_name,
        l.job_title as developer_needed,
        l.updated_at as lead_updated_at,
        lc.email::text as email,
        nullif(btrim(lc.linkedin_url), '') as linkedin_url,
        lc.updated_at as contact_updated_at
      from public.lead_contacts lc
      join public.leads l on l.id = lc.lead_id
      left join campaign_link cl
        on cl.lead_id = l.id
       and cl.lead_contact_id = lc.id
      where coalesce(lc.is_active, true) = true
        and coalesce(l.is_duplicate, false) = false
    )
    select
      count(*)::int as total,
      count(*) filter (where email is not null and btrim(email) <> '')::int as with_email,
      count(*) filter (where linkedin_url is not null and btrim(linkedin_url) <> '')::int as with_linkedin,
      count(*) filter (where campaign_id is not null)::int as in_campaign,
      count(*) filter (where developer_needed is not null and btrim(developer_needed) <> '')::int as with_job_title
    from base
    where (${campaignId}::uuid is null or campaign_id is not null)
      and (
      ${scope} = 'all_contacts'
      or (${scope} = 'campaign_contacts' and campaign_id is not null)
      or (${scope} = 'sendable_now' and campaign_state = 'in_campaign' and (next_run_at is null or next_run_at <= now()))
      )
      and (
        ${emailMode} = 'all'
        or (${emailMode} = 'with_email' and email is not null and btrim(email) <> '')
      )
      and (
        ${updatedInterval}::text is null
        or greatest(coalesce(contact_updated_at, '-infinity'::timestamptz), coalesce(lead_updated_at, '-infinity'::timestamptz)) >= now() - (${updatedInterval}::text)::interval
      )
  `;

  return row || {
    total: 0,
    with_email: 0,
    with_linkedin: 0,
    in_campaign: 0,
    with_job_title: 0,
  };
}

export async function listLeadExportRows(sql, filters, { limit = DEFAULT_LIMIT } = {}) {
  const campaignId = filters?.campaign_id === 'all' ? null : filters?.campaign_id || null;
  const updatedInterval = resolveUpdatedInterval(filters?.updated);
  const scope = filters?.scope || DEFAULT_SCOPE;
  const emailMode = filters?.email || DEFAULT_EMAIL;
  const resolvedLimit = normalizeInt(limit, filters?.limit || DEFAULT_LIMIT);

  return sql`
    with campaign_link as (
      select distinct on (cl.lead_id, cl.active_contact_id)
        cl.id as campaign_lead_id,
        cl.lead_id,
        cl.active_contact_id as lead_contact_id,
        cl.campaign_id,
        c.name as campaign_name,
        cl.state::text as campaign_state,
        cl.contact_attempt_no,
        cl.next_run_at,
        cl.updated_at as campaign_updated_at
      from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where (${campaignId}::uuid is null or cl.campaign_id = ${campaignId}::uuid)
      order by cl.lead_id, cl.active_contact_id, cl.updated_at desc
    )
    select
      l.id as lead_id,
      lc.id as lead_contact_id,
      cl.campaign_lead_id,
      cl.campaign_id,
      cl.campaign_name,
      cl.campaign_state,
      cl.contact_attempt_no,
      cl.next_run_at,
      l.company_name,
      l.domain,
      l.website_url,
      l.job_title as developer_needed,
      l.job_url,
      l.city as lead_city,
      l.country as lead_country,
      l.updated_at as lead_updated_at,
      lc.first_name,
      lc.last_name,
      lc.email::text as email,
      lc.phone,
      nullif(btrim(lc.linkedin_url), '') as linkedin_url,
      lc.title as contact_title,
      lc.seniority,
      lc.department,
      lc.city as contact_city,
      lc.country as contact_country,
      lc.updated_at as contact_updated_at
    from public.lead_contacts lc
    join public.leads l on l.id = lc.lead_id
    left join campaign_link cl
      on cl.lead_id = l.id
     and cl.lead_contact_id = lc.id
    where coalesce(lc.is_active, true) = true
      and coalesce(l.is_duplicate, false) = false
      and (${campaignId}::uuid is null or cl.campaign_id is not null)
      and (
        ${scope} = 'all_contacts'
        or (${scope} = 'campaign_contacts' and cl.campaign_id is not null)
        or (${scope} = 'sendable_now' and cl.campaign_state = 'in_campaign' and (cl.next_run_at is null or cl.next_run_at <= now()))
      )
      and (
        ${emailMode} = 'all'
        or (${emailMode} = 'with_email' and lc.email is not null and btrim(lc.email::text) <> '')
      )
      and (
        ${updatedInterval}::text is null
        or greatest(coalesce(lc.updated_at, '-infinity'::timestamptz), coalesce(l.updated_at, '-infinity'::timestamptz)) >= now() - (${updatedInterval}::text)::interval
      )
    order by coalesce(cl.campaign_updated_at, lc.updated_at, l.updated_at) desc, l.company_name asc, lc.last_name asc, lc.first_name asc
    limit ${resolvedLimit}
  `;
}

export function buildLeadExportQueryString(filters = {}, { format = null, limit = null } = {}) {
  const params = new URLSearchParams();
  if (filters.campaign_id && filters.campaign_id !== 'all') params.set('campaign_id', filters.campaign_id);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.email) params.set('email', filters.email);
  if (filters.updated) params.set('updated', filters.updated);
  if (format) params.set('format', format);
  if (limit) params.set('limit', String(limit));
  return params.toString();
}

export function getLeadExportScopeLabel(scope) {
  if (scope === 'all_contacts') return 'All contacts';
  if (scope === 'sendable_now') return 'Sendable now';
  return 'Campaign contacts';
}

export function getLeadExportUpdatedLabel(updated) {
  if (updated === '24h') return 'last 24h';
  if (updated === '7d') return 'last 7 days';
  if (updated === '30d') return 'last 30 days';
  return 'all time';
}

export function mapLeadExportRow(row) {
  return {
    campaign_name: row?.campaign_name || '',
    company_name: row?.company_name || '',
    developer_needed: row?.developer_needed || '',
    job_url: row?.job_url || '',
    first_name: row?.first_name || '',
    last_name: row?.last_name || '',
    email: row?.email || '',
    linkedin_url: row?.linkedin_url || '',
    contact_title: row?.contact_title || '',
    seniority: row?.seniority || '',
    department: row?.department || '',
    phone: row?.phone || '',
    campaign_state: row?.campaign_state || '',
    contact_attempt_no: row?.contact_attempt_no ?? '',
    next_run_at: row?.next_run_at || '',
    lead_city: row?.lead_city || '',
    lead_country: row?.lead_country || '',
    contact_city: row?.contact_city || '',
    contact_country: row?.contact_country || '',
    website_url: row?.website_url || '',
    domain: row?.domain || '',
  };
}

export function getLeadExportHeaders() {
  return Object.keys(mapLeadExportRow({}));
}

export function csvEscape(value) {
  const str = String(value ?? '');
  if (!/[",\n]/.test(str)) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

export function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildLeadExportCsv(rows = []) {
  const mapped = rows.map(mapLeadExportRow);
  const headers = getLeadExportHeaders();
  return [
    headers.join(','),
    ...mapped.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

export function buildLeadExportXlsHtml(rows = [], generatedAt = new Date().toISOString()) {
  const mapped = rows.map(mapLeadExportRow);
  const headers = getLeadExportHeaders();

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; }
          th { background: #f4f4f4; }
        </style>
      </head>
      <body>
        <h1>Lead export</h1>
        <p>Generated: ${htmlEscape(generatedAt)}</p>
        <table>
          <tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr>
          ${mapped.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header])}</td>`).join('')}</tr>`).join('')}
        </table>
      </body>
    </html>
  `;
}
