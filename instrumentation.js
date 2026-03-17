export async function register() {
  const { ensureInternalSchedulerStarted } = await import('./lib/internal-scheduler.js');
  ensureInternalSchedulerStarted('instrumentation');
}
