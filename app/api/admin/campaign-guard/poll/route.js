// Proxy endpoint: WebDash -> n8n Campaign Guard webhook
// + auto sync leads -> campaign_leads before forwarding
// Configure env:
// - N8N_GUARD_WEBHOOK_URL=https://.../webhook/...
// - N8N_GUARD_TOKEN=SUPER_SECRET_TOKEN

import { getSql } from '@/lib/db.js';
import { syncCampaignLeads } from '@/lib/campaign-guard.js';

const DEFAULT_CAMPAIGN_NAME = 'OUTSOURCING_IT_EVERGREEM';

async function ensureCampaign(sql, campaignId, campaignName) {
  if (campaignId) {
    const rows = await sql`
      select id
      from campaigns
      where id = ${campaignId}::uuid
      limit 1
    `;
    if (rows.length > 0) return rows[0].id;
  }

  const byName = await sql`
    select id
    from campaigns
    where name = ${campaignName}
    order by created_at desc
    limit 1
  `;

  if (byName.length > 0) return byName[0].id;

  const created = await sql`
    insert into campaigns (name, status, description, settings)
    values (
      ${campaignName},
      'running',
      'Kampania ciągła dla nowych leadów',
      ${JSON.stringify({ mode: 'evergreen', auto_enqueue: true, source: 'webdash_poll' })}::jsonb
    )
    returning id
  `;

  return created[0].id;
}

export async function POST(req) {
  try {
    const webhookUrl = process.env.N8N_GUARD_WEBHOOK_URL || 'https://n8n-production-c340.up.railway.app/webhook/campaign-guard-poll';
    const token = process.env.N8N_GUARD_TOKEN || 'SUPER_SECRET_TOKEN';
    const schedulerToken = process.env.WEBDASH_SCHEDULER_TOKEN || '';

    const authHeader = req.headers.get('authorization') || '';
    if (schedulerToken) {
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearer !== schedulerToken) {
        return new Response('unauthorized scheduler token', { status: 401 });
      }
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const sql = getSql();
    const campaignName = String(body?.campaign_name || DEFAULT_CAMPAIGN_NAME).trim() || DEFAULT_CAMPAIGN_NAME;
    const resolvedCampaignId = await ensureCampaign(sql, body?.campaign_id || null, campaignName);
    const syncResult = await syncCampaignLeads(sql, resolvedCampaignId);

    const payload = {
      token,
      campaign_id: resolvedCampaignId,
      limit: Number.isFinite(body?.limit) ? body.limit : 100,
      dry_run: Boolean(body?.dry_run ?? false),
    };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(t);

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const nextExpectedRunAt = new Date(Date.now() + Number((body?.interval_min || 10)) * 60 * 1000).toISOString();

    await sql`
      update campaigns
      set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify({
        auto_sync_status: res.ok ? 'running' : 'error',
        last_sync_at: new Date().toISOString(),
        last_sync_ok: res.ok,
        next_expected_run_at: nextExpectedRunAt,
      })}::jsonb || jsonb_build_object('last_sync_result', ${JSON.stringify(syncResult)}::jsonb, 'last_poll_response_ok', ${res.ok}),
          updated_at = now()
      where id = ${resolvedCampaignId}::uuid
    `;

    return Response.json(
      {
        ok: res.ok,
        forwarded_to: webhookUrl,
        request: payload,
        sync: {
          campaign_id: resolvedCampaignId,
          campaign_name: campaignName,
          ...syncResult,
        },
        response: data,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
}
