import { getSql } from '@/lib/db.js';
import { normalizeStoredCampaignSettings } from '@/lib/evergreen-config.js';
import { resolveSendEmailIntervalMin } from '@/lib/queue-view.js';

const ALLOWED = new Set(['stop', 'resume', 'requeue', 'mark_replied', 'mark_failed']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignLeadId = body?.campaign_lead_id;
    const action = (body?.action || '').trim();

    if (!campaignLeadId) throw new Error('missing campaign_lead_id');
    if (!ALLOWED.has(action)) throw new Error('invalid action');

    const sql = getSql();

    const [lead] = await sql`
      select
        cl.id,
        cl.lead_id,
        cl.active_contact_id,
        cl.campaign_id,
        c.settings as campaign_settings
      from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where cl.id = ${campaignLeadId}::uuid
      limit 1
    `;
    if (!lead) throw new Error('campaign_lead not found');

    const campaignSettings = normalizeStoredCampaignSettings(lead.campaign_settings);
    const requeueDelayMin = resolveSendEmailIntervalMin(campaignSettings);

    if (action === 'stop') {
      await sql`
        update public.campaign_leads
        set state = 'stopped'::public.lead_status,
            stop_reason = 'manual'::public.stop_reason,
            stopped_at = now(),
            next_run_at = null,
            updated_at = now()
        where id = ${campaignLeadId}::uuid
      `;
    }

    if (action === 'resume') {
      await sql`
        update public.campaign_leads
        set state = 'in_campaign'::public.lead_status,
            stop_reason = null,
            stopped_at = null,
            next_run_at = now(),
            updated_at = now()
        where id = ${campaignLeadId}::uuid
      `;
    }

    if (action === 'requeue') {
      await sql`
        update public.campaign_leads
        set state = 'in_campaign'::public.lead_status,
            next_run_at = now() + (${requeueDelayMin}::text || ' minutes')::interval,
            updated_at = now()
        where id = ${campaignLeadId}::uuid
      `;
    }

    if (action === 'mark_replied' || action === 'mark_failed') {
      const [attempt] = await sql`
        select id
        from public.message_attempts
        where lead_id = ${lead.lead_id}::uuid
          and lead_contact_id = ${lead.active_contact_id}::uuid
        order by created_at desc
        limit 1
      `;

      if (attempt?.id) {
        const eventType = action === 'mark_replied' ? 'replied' : 'failed';
        await sql`
          insert into public.message_events (message_attempt_id, event_type, event_meta)
          values (${attempt.id}::uuid, ${eventType}::public.message_event_type, jsonb_build_object('source','webdash_manual'))
        `;
      }

      if (action === 'mark_replied') {
        await sql`
          update public.campaign_leads
          set state = 'stopped'::public.lead_status,
              stop_reason = 'replied'::public.stop_reason,
              stopped_at = now(),
              next_run_at = null,
              updated_at = now()
          where id = ${campaignLeadId}::uuid
        `;
      } else {
        await sql`
          update public.campaign_leads
          set state = 'in_campaign'::public.lead_status,
              next_run_at = now() + interval '6 hours',
              updated_at = now()
          where id = ${campaignLeadId}::uuid
        `;
      }
    }

    return Response.json({ ok: true, campaign_lead_id: campaignLeadId, action });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
}
