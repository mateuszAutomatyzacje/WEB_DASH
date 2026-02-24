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
