import { sql } from '@/lib/db.js';

export async function GET() {
  const r = await sql`select now() as now`;
  return Response.json({ ok: true, now: r[0].now });
}
