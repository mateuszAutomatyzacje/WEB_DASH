export function requireAdmin(req) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) {
    // If not set, hard-deny to avoid accidental public admin actions.
    throw new Error('ADMIN_TOKEN not set');
  }
  const got = req.headers.get('x-admin-token') || new URL(req.url).searchParams.get('token');
  if (got !== need) {
    throw new Error('unauthorized');
  }
}
