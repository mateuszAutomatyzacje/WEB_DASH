import { getSql } from '@/lib/db.js';
import { syncScrapeSettingsFromCampaign } from '@/lib/scrape-settings.js';
// auth disabled for now

export async function POST(req) {
  try {
    let campaign_id = null;
    try {
      const j = await req.json();
      campaign_id = j?.campaign_id;
    } catch {}
    if (!campaign_id) {
      try {
        const fd = await req.formData();
        campaign_id = fd.get('campaign_id');
      } catch {}
    }
    if (!campaign_id) throw new Error('missing campaign_id');

    const sql = getSql();
    const rows = await sql`
      update campaigns
      set status = 'running', updated_at = now()
      where id = ${campaign_id}
      returning id, name
    `;

    if (rows[0]?.id) {
      await syncScrapeSettingsFromCampaign(sql, { campaignId: rows[0].id, campaignName: rows[0].name });
    }

    return Response.json({ ok: true, campaign_id, status: 'running' });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
