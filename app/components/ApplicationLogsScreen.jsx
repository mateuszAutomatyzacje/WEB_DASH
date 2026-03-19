import { AppShell } from '@/app/components/AppShell.jsx';
import LiveApplicationLogsPanel from '@/app/components/LiveApplicationLogsPanel.jsx';
import { getSql } from '@/lib/db.js';
import { listApplicationLogEntries } from '@/lib/application-logs.js';

export default async function ApplicationLogsScreen({
  title = 'Logs',
  subtitle = 'Live timeline of runtime, scheduler, scraper and delivery events.',
} = {}) {
  const sql = getSql();
  const initialEntries = await listApplicationLogEntries(sql, { limit: 160 });

  return (
    <AppShell title={title} subtitle={subtitle}>
      <LiveApplicationLogsPanel initialEntries={initialEntries} />
    </AppShell>
  );
}
