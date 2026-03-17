-- Enable multiple contacts per lead in campaign_leads.
-- Previous unique constraint: (campaign_id, lead_id)
-- New unique constraint: (campaign_id, lead_id, active_contact_id)

begin;

alter table public.campaign_leads
  drop constraint if exists campaign_leads_unique;

alter table public.campaign_leads
  add constraint campaign_leads_unique
  unique (campaign_id, lead_id, active_contact_id);

commit;
