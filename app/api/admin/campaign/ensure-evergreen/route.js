import { getSql } from '@/lib/db.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body?.name || 'OUTSOURCING_IT_EVERGREEM').trim();
    const description = 'Kampania ciągła dla nowych leadów';
    const settings = {
      mode: 'evergreen',
      send_interval_min: 5,
      auto_enqueue: true,
    };

    const sql = getSql();

    const existing = await sql`
      select id
      from campaigns
      where name = ${name}
      order by created_at desc
      limit 1
    `;

    let campaign_id;
    if (existing.length > 0) {
      campaign_id = existing[0].id;
      await sql`
        update campaigns
        set status = 'running',
            description = ${description},
            settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify(settings)}::jsonb,
            updated_at = now()
        where id = ${campaign_id}
      `;
    } else {
      const created = await sql`
        insert into campaigns (name, status, description, settings)
        values (${name}, 'running', ${description}, ${JSON.stringify(settings)}::jsonb)
        returning id
      `;
      campaign_id = created[0].id;
    }

    return Response.json({ ok: true, campaign_id, name, status: 'running' });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
