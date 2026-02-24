-- Postgres schema: Lead funnel → Campaign guard → Reports (v2)
-- Based on provided architecture diagram.
--
-- v2 changes (based on Mateusz feedback / gaps):
-- 1) Add per-message telemetry tables: message_attempts + message_events
-- 2) Optional dedupe support: unique indexes on (email_sha256) and (domain_sha256) when present
-- 3) Extend worker pipeline lightly: lead_assignment_notes + SLA fields
-- 4) Extensions remain (pgcrypto, citext) with notes for fallback
--
-- NOTE: If your Postgres environment does NOT allow extensions:
-- - Remove CREATE EXTENSION lines
-- - Replace gen_random_uuid() defaults with app-generated UUID
-- - Replace citext with text and store normalized lower(email)

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ========= ENUMS =========
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('new','enriched','email_built','queued','in_campaign','stopped','handed_off','closed','invalid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft','ready','running','paused','stopped','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE step_channel AS ENUM ('email','linkedin','call','sms','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assignment_status AS ENUM ('assigned','accepted','in_progress','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stop_reason AS ENUM ('replied','bounced','unsubscribed','manual','invalid','duplicate','rate_limit','complaint','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_direction AS ENUM ('outbound','inbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_event_type AS ENUM ('queued','sent','delivered','opened','clicked','bounced','complained','unsubscribed','replied','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========= CORE ENTITIES =========

CREATE TABLE IF NOT EXISTS lead_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}',
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count int NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext,
  phone text,
  domain text,
  company_name text,
  person_full_name text,
  person_first_name text,
  person_last_name text,
  country text,
  city text,
  linkedin_url text,
  website_url text,
  status lead_status NOT NULL DEFAULT 'new',
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean NOT NULL DEFAULT false,
  duplicate_of uuid REFERENCES leads(id),
  email_sha256 bytea,
  domain_sha256 bytea,
  CONSTRAINT leads_email_or_phone_or_domain_chk CHECK (
    email IS NOT NULL OR phone IS NOT NULL OR domain IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES lead_import_batches(id) ON DELETE SET NULL,
  source_row_id text,
  raw jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  enrichment_provider text,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb NOT NULL DEFAULT '{}',
  score numeric(5,2),
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id uuid,
  kind text NOT NULL,
  language text DEFAULT 'pl',
  content text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ========= CAMPAIGNS / SEQUENCES =========

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status campaign_status NOT NULL DEFAULT 'draft',
  description text,
  settings jsonb NOT NULL DEFAULT '{}',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_no int NOT NULL,
  channel step_channel NOT NULL DEFAULT 'email',
  delay_hours int NOT NULL DEFAULT 24,
  template_subject text,
  template_body text,
  meta jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT sequence_steps_unique_step UNIQUE(sequence_id, step_no)
);

CREATE TABLE IF NOT EXISTS campaign_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  state lead_status NOT NULL DEFAULT 'queued',
  current_step_no int,
  next_run_at timestamptz,
  stop_reason stop_reason,
  stopped_at timestamptz,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_leads_unique UNIQUE(campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS lead_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ========= MESSAGE TELEMETRY (v2) =========

-- One row per outbound message attempt (per lead, per campaign/sequence step)
CREATE TABLE IF NOT EXISTS message_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  sequence_id uuid REFERENCES sequences(id) ON DELETE SET NULL,
  sequence_step_id uuid REFERENCES sequence_steps(id) ON DELETE SET NULL,

  direction message_direction NOT NULL DEFAULT 'outbound',
  channel step_channel NOT NULL DEFAULT 'email',

  provider text,                -- instantly/lemlist/sendgrid/gmail/custom
  provider_message_id text,     -- id from provider

  to_email citext,
  from_email citext,
  subject text,

  payload jsonb NOT NULL DEFAULT '{}',

  queued_at timestamptz,
  sent_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only event stream per message (delivery/open/click/bounce/reply)
CREATE TABLE IF NOT EXISTS message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_attempt_id uuid NOT NULL REFERENCES message_attempts(id) ON DELETE CASCADE,
  event_type message_event_type NOT NULL,
  event_meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ========= HANDOFF TO WORKERS (v2 light extension) =========

CREATE TABLE IF NOT EXISTS workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
  status assignment_status NOT NULL DEFAULT 'assigned',
  reason text,
  sla_due_at timestamptz,        -- optional SLA
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);

CREATE TABLE IF NOT EXISTS lead_assignment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES lead_assignments(id) ON DELETE CASCADE,
  author text,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ========= REPORTING / ARCHIVE =========

CREATE TABLE IF NOT EXISTS report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  scope text NOT NULL DEFAULT 'global',
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshots_unique UNIQUE(snapshot_date, scope)
);

-- ========= INDEXES =========

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);

CREATE INDEX IF NOT EXISTS idx_lead_sources_lead ON lead_sources(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_batch ON lead_sources(batch_id);
CREATE INDEX IF NOT EXISTS idx_enrich_lead ON lead_enrichments(lead_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_state ON campaign_leads(state);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_next_run ON campaign_leads(next_run_at);

CREATE INDEX IF NOT EXISTS idx_events_lead ON lead_stage_events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON lead_stage_events(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assign_worker ON lead_assignments(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_assign_lead ON lead_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_assign_sla_due ON lead_assignments(sla_due_at);

CREATE INDEX IF NOT EXISTS idx_msg_attempt_lead ON message_attempts(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_attempt_campaign ON message_attempts(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_attempt_provider ON message_attempts(provider, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_msg_events_attempt ON message_events(message_attempt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_events_type ON message_events(event_type, created_at DESC);

-- ========= OPTIONAL DEDUPE (v2) =========
-- Turn on if you want hard dedupe when hashes are present.
-- If you sometimes intentionally import duplicates, keep these commented.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_email_sha256 ON leads(email_sha256) WHERE email_sha256 IS NOT NULL;
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_domain_sha256 ON leads(domain_sha256) WHERE domain_sha256 IS NOT NULL;

-- ========= TRIGGERS =========

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_campaign_leads_updated BEFORE UPDATE ON campaign_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_assignments_updated BEFORE UPDATE ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
