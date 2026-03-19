import ApplicationLogsScreen from '@/app/components/ApplicationLogsScreen.jsx';

export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  return (
    <ApplicationLogsScreen
      title="Logs"
      subtitle="Pelny widok logow aplikacji: delivery, scraper, scheduler i checkpointy evergreen."
    />
  );
}
