import ApplicationLogsScreen from '@/app/components/ApplicationLogsScreen.jsx';

export const dynamic = 'force-dynamic';

export default async function WorkersPage() {
  return (
    <ApplicationLogsScreen
      title="Operations"
      subtitle="Timeline wysylek, eventy delivery, stan scrapera i checkpointy evergreen w jednym miejscu."
    />
  );
}
