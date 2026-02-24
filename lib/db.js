import postgres from 'postgres';

let _sql = null;

export function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Don't throw during build-time module evaluation.
    // Runtime requests will fail fast in handlers/pages that call getSql().
    throw new Error('Missing DATABASE_URL');
  }
  _sql = postgres(url, { ssl: 'require', max: 5 });
  return _sql;
}
