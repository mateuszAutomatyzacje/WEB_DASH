import { getSql } from '@/lib/db.js';
import { syncScrapeSettingsFromCampaign } from '@/lib/scrape-settings.js';

const ALLOWED = new Set(['draft', 'ready', 'running', 'paused', 'stopped', 'archived']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaign_id = body?.campaign_id;
    const status = (body?.status || '').trim();

    if (!campaign_id) throw new Error('missing campaign_id');
    if (!ALLOWED.has(status)) throw new Error('invalid status');

    const sql = getSql();
    const rows = await sql`
      update campaigns
      set status = ${status}::campaign_status,
          updated_at = now()
      where id = ${campaign_id}
      returning id, name
    `;

    if (rows[0]?.id) {
      await syncScrapeSettingsFromCampaign(sql, { campaignId: rows[0].id, campaignName: rows[0].name });
    }

    return Response.json({ ok: true, campaign_id, status });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
