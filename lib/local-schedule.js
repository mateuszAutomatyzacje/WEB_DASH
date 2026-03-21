const DEFAULT_LOCAL_TIMEZONE = 'Europe/Warsaw';

const WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export { DEFAULT_LOCAL_TIMEZONE };

export function parseTimeValue(value, fallbackLabel) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
  if (!match) {
    const fallback = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(fallbackLabel).trim());
    return {
      hour: Number(fallback?.[1] || 0),
      minute: Number(fallback?.[2] || 0),
      second: Number(fallback?.[3] || 0),
      label: fallbackLabel,
    };
  }

  const hour = Math.min(Math.max(Number(match[1]), 0), 23);
  const minute = Math.min(Math.max(Number(match[2]), 0), 59);
  const second = Math.min(Math.max(Number(match[3] || 0), 0), 59);

  return {
    hour,
    minute,
    second,
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
  };
}

export function getLocalDateTimeParts(date = new Date(), timeZone = DEFAULT_LOCAL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayShort = String(byType.weekday || 'mon').slice(0, 3).toLowerCase();
  const weekdayIndex = WEEKDAY_INDEX[weekdayShort] ?? 1;

  return {
    hour: Number(byType.hour || 0),
    minute: Number(byType.minute || 0),
    second: Number(byType.second || 0),
    label: `${byType.hour || '00'}:${byType.minute || '00'}:${byType.second || '00'}`,
    weekday_index: weekdayIndex,
    weekday_short: weekdayShort,
    weekday_label: WEEKDAY_LABELS[weekdayIndex] || 'Monday',
  };
}

export function toLocalSeconds(parts) {
  return Number(parts?.hour || 0) * 3600 + Number(parts?.minute || 0) * 60 + Number(parts?.second || 0);
}

export function isWeekendWeekdayIndex(weekdayIndex) {
  return weekdayIndex === 0 || weekdayIndex === 6;
}

export function isTimeInWindow(currentSeconds, startSeconds, endSeconds) {
  if (startSeconds === endSeconds) return true;
  if (startSeconds < endSeconds) {
    return currentSeconds >= startSeconds && currentSeconds < endSeconds;
  }
  return currentSeconds >= startSeconds || currentSeconds < endSeconds;
}
