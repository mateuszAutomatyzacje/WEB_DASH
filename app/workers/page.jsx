import ApplicationLogsScreen from '@/app/components/ApplicationLogsScreen.jsx';

export const dynamic = 'force-dynamic';

export default async function WorkersPage() {
  return (
    <ApplicationLogsScreen
      title="Operations"
      subtitle="Live timeline of scheduler, scraper, campaign ticks and delivery events in one place."
    />
  );
}
