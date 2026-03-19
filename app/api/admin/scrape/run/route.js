import { getSql } from '@/lib/db.js';
import { runScrapeNow } from '@/lib/scrape-cron.js';

export async function POST() {
  try {
    const sql = getSql();
    const result = await runScrapeNow(sql, { source: 'api_scrape_run' });
    return Response.json(result);
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
