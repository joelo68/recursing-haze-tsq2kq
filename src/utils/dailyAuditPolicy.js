export const TAIPEI_TIME_ZONE = "Asia/Taipei";
export const DAILY_AUDIT_CUTOFF_HOUR = 18;

export const getTaipeiDateTimeParts = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute || 0),
  };
};

export const formatCalendarDate = (year, month, day) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

export const shiftCalendarDate = (year, month, day, deltaDays = 0) => {
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);
  return formatCalendarDate(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate()
  );
};

export const getDefaultDailyAuditDate = (value = new Date()) => {
  const taipei = getTaipeiDateTimeParts(value);
  if (taipei.hour < DAILY_AUDIT_CUTOFF_HOUR) {
    return shiftCalendarDate(taipei.year, taipei.month, taipei.day, -1);
  }
  return formatCalendarDate(taipei.year, taipei.month, taipei.day);
};

export const getMillisecondsUntilNextTaipeiCutoff = (value = new Date()) => {
  const nowMs = value.getTime();
  const taipei = getTaipeiDateTimeParts(value);

  // Taiwan is fixed at UTC+8. 18:00 Asia/Taipei equals 10:00 UTC.
  let cutoffMs = Date.UTC(
    taipei.year,
    taipei.month - 1,
    taipei.day,
    DAILY_AUDIT_CUTOFF_HOUR - 8,
    0,
    0,
    0
  );

  if (nowMs >= cutoffMs) cutoffMs += 24 * 60 * 60 * 1000;
  return Math.max(1000, cutoffMs - nowMs);
};

export const getMillisecondsUntilNextTaipeiActionBoundary = (value = new Date()) => {
  const nowMs = value.getTime();
  const taipei = getTaipeiDateTimeParts(value);

  const midnightMs = Date.UTC(
    taipei.year,
    taipei.month - 1,
    taipei.day + 1,
    -8,
    0,
    0,
    0
  );

  let cutoffMs = Date.UTC(
    taipei.year,
    taipei.month - 1,
    taipei.day,
    DAILY_AUDIT_CUTOFF_HOUR - 8,
    0,
    0,
    0
  );
  if (nowMs >= cutoffMs) cutoffMs += 24 * 60 * 60 * 1000;

  return Math.max(1000, Math.min(midnightMs, cutoffMs) - nowMs);
};

export const getDailyAuditPolicy = (value = new Date()) => {
  const taipei = getTaipeiDateTimeParts(value);
  const todayDate = formatCalendarDate(taipei.year, taipei.month, taipei.day);
  const cutoffReached = taipei.hour >= DAILY_AUDIT_CUTOFF_HOUR;

  return {
    todayDate,
    todayYearMonth: todayDate.slice(0, 7),
    cutoffReached,
    phase: cutoffReached ? "ready" : "in_progress",
    reportingDate: getDefaultDailyAuditDate(value),
  };
};
