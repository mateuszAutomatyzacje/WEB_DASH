import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME, normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const campaignId = (url.searchParams.get('campaignId') || '').trim();
    const name = (url.searchParams.get('name') || DEFAULT_EVERGREEN_NAME).trim();

    const sql = getSql();

    let rows = [];
    if (campaignId) {
      rows = await sql`
        select id, name, description, status::text as status, created_at, updated_at, settings
        from campaigns
        where id = ${campaignId}
        limit 1
      `;
    } else {
      rows = await sql`
        select id, name, description, status::text as status, created_at, updated_at, settings
        from campaigns
        where name = ${name}
        order by created_at desc
        limit 1
      `;
    }

    if (!rows.length) return Response.json({ ok: false, found: false, name, campaignId: campaignId || null });

    const campaign = {
      ...rows[0],
      settings: normalizeStoredCampaignSettings(rows[0]?.settings),
    };
    const duplicates = await sql`
      select count(*)::int as total
      from campaigns
      where name = ${campaign.name}
    `;

    return Response.json({
      ok: true,
      found: true,
      matchedBy: campaignId ? 'id' : 'name',
      duplicate_count_for_name: duplicates[0]?.total ?? 1,
      campaign,
      ...campaign,
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
