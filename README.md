# LeadGuard Dashboard (Railway)

Next.js App Router dashboard for the lead funnel → campaign guard system.

## Env
- `DATABASE_URL` (Railway Postgres)

## Scripts
- `npm run dev`
- `npm run build`
- `npm start`
- `npm run snapshots` (compute report snapshots)

## Endpoints
- `/api/health` – DB connectivity check
- `/` – simple dashboard (reads `report_snapshots`)
