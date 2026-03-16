import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import { loadOutbox, resolveOrCreateCampaign, stopRepliedCampaignLeads } from '@/lib/campaign-guard.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaign_id') || null;
    const campaignName = searchParams.get('campaign_name') || DEFAULT_EVERGREEN_NAME;
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 500);

    const sql = getSql();
    const campaign = await resolveOrCreateCampaign(sql, {
      campaignId,
      campaignName,
      source: 'webdash_outbox',
    });

    await stopRepliedCampaignLeads(sql, campaign.id);
    const rows = await loadOutbox(sql, campaign.id, limit);

    return Response.json({ ok: true, campaign, count: rows.length, rows });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
