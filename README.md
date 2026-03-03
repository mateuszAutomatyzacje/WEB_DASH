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

## Campaign Guard polling from WebDash (every 5 min)
Set envs in WebDash runtime:
- `N8N_GUARD_WEBHOOK_URL=https://.../webhook/<path_z_n8n>`
- `N8N_GUARD_TOKEN=SUPER_SECRET_TOKEN`

Then call from scheduler (every 5 minutes):
- **Method:** `POST`
- **URL:** `/api/admin/campaign-guard/poll`
- **Headers:** `Content-Type: application/json`
- **Body:**
```json
{
  "campaign_id": null,
  "limit": 100,
  "dry_run": false
}
```

WebDash endpoint will forward request to n8n as:
```json
{
  "token": "SUPER_SECRET_TOKEN",
  "campaign_id": null,
  "limit": 100,
  "dry_run": false
}
```
