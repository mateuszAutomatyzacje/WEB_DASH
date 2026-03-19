import ApplicationLogsScreen from '@/app/components/ApplicationLogsScreen.jsx';

export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  return (
    <ApplicationLogsScreen
      title="Logs"
      subtitle="Live timeline of scheduler, scraper, campaign ticks and delivery events from top to bottom."
    />
  );
}
