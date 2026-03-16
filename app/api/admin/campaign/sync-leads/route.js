import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import { resolveOrCreateCampaign, stopRepliedCampaignLeads, syncCampaignLeads } from '@/lib/campaign-guard.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignName = String(body?.campaign_name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;

    const sql = getSql();
    const campaign = await resolveOrCreateCampaign(sql, {
      campaignId: body?.campaign_id || null,
      campaignName,
      source: 'webdash_sync_leads',
    });

    const result = await syncCampaignLeads(sql, campaign.id);
    const replied = await stopRepliedCampaignLeads(sql, campaign.id);

    await sql`
      update public.campaigns
      set settings = coalesce(settings, '{}'::jsonb) || ${sql.json({
        auto_sync_status: 'running',
        last_sync_at: new Date().toISOString(),
        last_sync_ok: true,
      })}::jsonb || jsonb_build_object('last_sync_result', ${sql.json(result)}::jsonb),
          updated_at = now()
      where id = ${campaign.id}::uuid
    `;

    return Response.json({
      ok: true,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      replied,
      ...result,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
