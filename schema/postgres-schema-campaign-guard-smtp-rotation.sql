-- Campaign Guard SMTP rotation tables (daily cap per account)
-- Purpose: enable deterministic account rotation (e.g. 25 mails/day per mailbox)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE smtp_account_status AS ENUM ('active','paused','disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE smtp_send_status AS ENUM ('sent','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS smtp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL UNIQUE,              -- stable identifier, e.g. mailbox login
  provider text NOT NULL DEFAULT 'smtp',         -- smtp/gmail/outlook/custom
  from_email citext,
  from_name text,
  daily_limit int NOT NULL DEFAULT 25,
  priority int NOT NULL DEFAULT 100,             -- lower = picked earlier
  status smtp_account_status NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smtp_accounts_daily_limit_chk CHECK (daily_limit > 0)
);

-- Daily usage counter (UTC day); one row per account/day
CREATE TABLE IF NOT EXISTS smtp_account_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_account_id uuid NOT NULL REFERENCES smtp_accounts(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smtp_account_usage_unique UNIQUE (smtp_account_id, usage_date),
  CONSTRAINT smtp_account_usage_non_negative_chk CHECK (sent_count >= 0 AND failed_count >= 0)
);

-- Immutable send audit for each provider call
CREATE TABLE IF NOT EXISTS message_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_lead_id uuid REFERENCES campaign_leads(id) ON DELETE SET NULL,
  message_attempt_id uuid REFERENCES message_attempts(id) ON DELETE SET NULL,
  smtp_account_id uuid REFERENCES smtp_accounts(id) ON DELETE SET NULL,
  to_email citext,
  subject text,
  status smtp_send_status NOT NULL,
  provider_message_id text,
  error text,
  send_meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smtp_accounts_status_prio ON smtp_accounts(status, priority, id);
CREATE INDEX IF NOT EXISTS idx_smtp_usage_day ON smtp_account_usage(usage_date, smtp_account_id);
CREATE INDEX IF NOT EXISTS idx_msg_sends_attempt ON message_sends(message_attempt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_sends_account_day ON message_sends(smtp_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_smtp_accounts_updated BEFORE UPDATE ON smtp_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_smtp_usage_updated BEFORE UPDATE ON smtp_account_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
