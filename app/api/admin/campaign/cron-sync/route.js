import { getSql } from '@/lib/db.js';
import { DEFAULT_EVERGREEN_NAME } from '@/lib/evergreen-config.js';
import { runCampaignCronTick } from '@/lib/campaign-cron.js';

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
    const campaignName = String(body?.campaign_name || DEFAULT_EVERGREEN_NAME).trim() || DEFAULT_EVERGREEN_NAME;
    const sql = getSql();
    const result = await runCampaignCronTick(sql, {
      campaignId: body?.campaign_id || null,
      campaignName,
      intervalMin: body?.interval_min || null,
      limit: Math.min(Math.max(Number(body?.limit || 25), 1), 200),
      dryRun: Boolean(body?.dry_run ?? false),
      forceSync: body?.force_sync === true,
      forceSend: body?.force_send === true,
      source: 'webdash_cron_sync',
      executionMode: Boolean(body?.dry_run ?? false) ? 'cron_sync_preview' : 'cron_sync',
    });

    return Response.json(result);
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
