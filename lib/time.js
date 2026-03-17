export const APP_TIME_ZONE = 'Europe/Warsaw';

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value, { fallback = '-', includeSeconds = true, locale = 'pl-PL', timeZone = APP_TIME_ZONE } = {}) {
  const date = toValidDate(value);
  if (!date) return fallback;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });

  return formatter.format(date).replace(',', '');
}
