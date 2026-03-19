import { getSql } from '@/lib/db.js';
import { runScrapeTick } from '@/lib/scrape-cron.js';

export async function POST() {
  try {
    const sql = getSql();
    const result = await runScrapeTick(sql, { source: 'api_scrape_tick' });
    return Response.json(result);
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
