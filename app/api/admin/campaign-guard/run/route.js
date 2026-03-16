import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import { runCampaignGuard } from '@/lib/campaign-guard.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignName = String(body?.campaign_name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const dryRun = Boolean(body?.dry_run ?? true);
    const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 200);

    const sql = getSql();
    const result = await runCampaignGuard(sql, {
      campaignId: body?.campaign_id || null,
      campaignName,
      dryRun,
      limit,
      performSync: true,
      source: 'webdash_run',
      executionMode: dryRun ? 'webdash_preview' : 'webdash_run',
    });

    return Response.json(result);
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
