# LeadGuard Dashboard (Railway)

Next.js App Router dashboard for the lead funnel → campaign guard system.

## Env
- `DATABASE_URL` (Railway Postgres)

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
- **Headers:** `Content-Type: application/json`
- **Body:**
```json
{
  "campaign_id": null,
  "campaign_name": "OUTSOURCING_IT_EVERGREEM",
  "limit": 100,
  "dry_run": false
}
```

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
- `POST /api/admin/campaign-guard/run` with `dry_run:false` → live send via SMTP webhook and DB status updates

For live send (`dry_run:false`) preferred envs:
- `N8N_SMTP_SEND_WEBHOOK_URL=https://.../webhook/<smtp-send-path>`
- `N8N_SMTP_SEND_TOKEN=...` (optional)

Requirement for live send:
- `N8N_SMTP_SEND_WEBHOOK_URL` is required. Without it, LIVE send returns an explicit error.

## Deployment note
- Last report refresh commit timestamp (UTC): 2026-03-06 09:01:45 UTC

