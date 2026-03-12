import { getSql } from '@/lib/db.js';

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
      ${JSON.stringify({ mode: 'evergreen', auto_enqueue: true, source: 'webdash_cron_sync', auto_sync_enabled: true, auto_sync_status: 'running', sync_interval_min: 10 })}::jsonb
    )
    returning id
  `;

  return created[0].id;
}

async function syncCampaignLeads(sql, campaignId) {
  const rows = await sql`
    with src as (
      select distinct ma.lead_id, ma.lead_contact_id
      from public.message_attempts ma
      where ma.lead_id is not null
        and ma.lead_contact_id is not null
    ), upserted as (
      insert into public.campaign_leads (
        campaign_id,
        lead_id,
        state,
        active_contact_id,
        contact_attempt_no,
        next_run_at,
        entered_at,
        updated_at
      )
      select
        ${campaignId}::uuid,
        s.lead_id,
        'in_campaign'::public.lead_status,
        s.lead_contact_id,
        1,
        now(),
        now(),
        now()
      from src s
      on conflict (campaign_id, lead_id) do update
      set
        active_contact_id = excluded.active_contact_id,
        state = case
          when campaign_leads.state = 'stopped' then campaign_leads.state
          else 'in_campaign'::public.lead_status
        end,
        updated_at = now()
      returning (xmax = 0) as inserted
    )
    select
      count(*)::int as total,
      count(*) filter (where inserted)::int as inserted,
      count(*) filter (where not inserted)::int as updated
    from upserted
  `;

  return rows[0] || { total: 0, inserted: 0, updated: 0 };
}

export async function POST(req) {
  try {
    const schedulerToken = process.env.WEBDASH_SCHEDULER_TOKEN || '';
    const authHeader = req.headers.get('authorization') || '';
    if (schedulerToken) {
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearer !== schedulerToken) {
        return new Response('unauthorized scheduler token', { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const campaignName = String(body?.campaign_name || DEFAULT_CAMPAIGN_NAME).trim() || DEFAULT_CAMPAIGN_NAME;
    const intervalMin = Number(body?.interval_min || 10);

    const sql = getSql();
    const campaignId = await ensureCampaign(sql, body?.campaign_id || null, campaignName);
    const result = await syncCampaignLeads(sql, campaignId);
    const nextExpectedRunAt = new Date(Date.now() + intervalMin * 60 * 1000).toISOString();

    await sql`
      update campaigns
      set status = 'running'::campaign_status,
          settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify({
            auto_sync_enabled: true,
            auto_sync_status: 'running',
            sync_interval_min: intervalMin,
            last_sync_at: new Date().toISOString(),
            last_sync_ok: true,
            next_expected_run_at: nextExpectedRunAt,
          })}::jsonb || jsonb_build_object('last_sync_result', ${JSON.stringify(result)}::jsonb),
          updated_at = now()
      where id = ${campaignId}::uuid
    `;

    return Response.json({
      ok: true,
      mode: 'cron-sync-only',
      campaign_id: campaignId,
      campaign_name: campaignName,
      next_expected_run_at: nextExpectedRunAt,
      ...result,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
