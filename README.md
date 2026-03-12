# LeadGuard Dashboard (Railway)

Next.js App Router dashboard for the lead funnel → campaign guard system.

## Env
- `DATABASE_URL` (Railway Postgres)
- `WEBDASH_SCHEDULER_TOKEN` (opcjonalny bearer token dla Railway Cron / schedulera)

## Scripts
- `npm run dev`
- `npm run build`
- `npm start`
- `npm run snapshots` (compute report snapshots)

## Routes
- `/api/health` – DB connectivity check
- `/` – Overview (KPIs from latest `report_snapshots` global scope, fallback to live aggregations)
- `/campaigns` – campaign list
- `/campaigns/[id]` – campaign detail (leads + message event counts)
- `/leads` – lead list
- `/queue` – queue view (`campaign_leads.next_run_at`)
- `/workers` – workers + assignments tables
- `/api/admin/campaign-guard/poll` – proxy trigger WebDash -> n8n Campaign Guard webhook

## Campaign Guard polling from WebDash (every 10 min)
Set envs in WebDash runtime:
- `N8N_GUARD_WEBHOOK_URL=https://.../webhook/<path_z_n8n>`
- `N8N_GUARD_TOKEN=SUPER_SECRET_TOKEN`

Then call from scheduler (every 10 minutes):
- **Method:** `POST`
- **URL:** `/api/admin/campaign-guard/poll`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <WEBDASH_SCHEDULER_TOKEN>` (recommended)
- **Body:**
```json
{
  "campaign_id": null,
  "campaign_name": "OUTSOURCING_IT_EVERGREEM",
  "limit": 100,
  "dry_run": false,
  "interval_min": 10
}
```

### Preferred scheduler-safe endpoint (sync only, no n8n forward)
Use this for cron/scheduler if you want only lead auto-sync without triggering send flow:

- **Method:** `POST`
- **URL:** `https://<twoj-webdash-domain>/api/admin/campaign/cron-sync`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <WEBDASH_SCHEDULER_TOKEN>`
- **Body:**
```json
{
  "campaign_id": null,
  "campaign_name": "OUTSOURCING_IT_EVERGREEM",
  "interval_min": 10
}
```

### Railway Cron / Scheduled Job recipe
- trigger: every 10 min
- method: POST
- target: `https://<twoj-webdash-domain>/api/admin/campaign/cron-sync`
- auth header: `Authorization: Bearer <WEBDASH_SCHEDULER_TOKEN>`
- content-type: `application/json`
- body: jak wyżej

This endpoint now does two things in one run:
1. auto-sync new leads (`message_attempts` -> `campaign_leads`) for evergreen campaign,
2. forward poll to n8n webhook.

Forwarded payload to n8n:
```json
{
  "token": "SUPER_SECRET_TOKEN",
  "campaign_id": "<resolved_uuid>",
  "limit": 100,
  "dry_run": false
}
```

Optional manual sync-only endpoint:
- `POST /api/admin/campaign/sync-leads`
- body: `{ "campaign_id": null, "campaign_name": "OUTSOURCING_IT_EVERGREEM" }`

New WebDash-first send flow endpoints:
- `GET /api/admin/campaign-guard/outbox?campaign_name=OUTSOURCING_IT_EVERGREEM&limit=50` → ready messages from DB sequence (email/FU1/FU2)
- `POST /api/admin/campaign-guard/run` with `{ "campaign_name":"OUTSOURCING_IT_EVERGREEM", "limit":25, "dry_run":true }` → preview queue
- `POST /api/admin/campaign-guard/run` with `dry_run:false` → live send via webhook + DB status updates

Live webhook payload from WebDash run:
```json
{
  "token": "...",
  "campaign_id": "...",
  "lead_id": "...",
  "lead_contact_id": "...",
  "campaign_lead_id": "...",
  "message_attempt_id": "...",
  "contact_attempt_no": 1
}
```

For live send (`dry_run:false`) preferred envs:
- `N8N_SMTP_SEND_WEBHOOK_URL=https://.../webhook/<smtp-send-path>`
- `N8N_SMTP_SEND_TOKEN=...` (optional)

Live send webhook:
- preferred env: `N8N_SMTP_SEND_WEBHOOK_URL`
- current default in code: `https://n8n-production-c340.up.railway.app/webhook/smtp-send` (production URL, not webhook-test)

## Deployment note
- Last report refresh commit timestamp (UTC): 2026-03-06 10:01:35 UTC

