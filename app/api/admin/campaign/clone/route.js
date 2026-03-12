import { getSql } from '@/lib/db.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaign_id = body?.campaign_id;
    const suffix = String(body?.suffix || ' (Copy)').trim() || ' (Copy)';

    if (!campaign_id) throw new Error('missing campaign_id');

    const sql = getSql();
    const sourceRows = await sql`
      select name, description, settings
      from campaigns
      where id = ${campaign_id}
      limit 1
    `;
    const source = sourceRows[0];
    if (!source) throw new Error('campaign not found');

    const cloneRows = await sql`
      insert into campaigns (name, status, description, settings)
      values (${`${source.name}${suffix}`}, 'draft'::campaign_status, ${source.description}, ${JSON.stringify(source.settings || {})}::jsonb)
      returning id, name, status::text as status
    `;

    return Response.json({ ok: true, source_campaign_id: campaign_id, ...cloneRows[0] });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
