const REPORT_TIME_ZONE = "Asia/Taipei";
const REPORT_DAY_ROLLOVER_HOUR = 4;
const SAME_DAY_SUBMIT_START_HOUR = 15;

const taipeiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatDateKey = (year, month, day) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const isValidDateKey = (value) => {
  const match = DATE_KEY_RE.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};

const shiftDateKey = (dateKey, deltaDays) => {
  const match = DATE_KEY_RE.exec(String(dateKey || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays));
  return formatDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

export const getTaipeiClock = (now = new Date()) => {
  const parts = Object.fromEntries(
    taipeiFormatter
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    dateKey: formatDateKey(parts.year, parts.month, parts.day),
    hour,
    minute,
    second: Number(parts.second),
    timeText: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
};

export const getCurrentTaipeiReportDate = (now = new Date()) => {
  const clock = getTaipeiClock(now);
  return clock.hour < REPORT_DAY_ROLLOVER_HOUR ? shiftDateKey(clock.dateKey, -1) : clock.dateKey;
};

export const classifyDailyReportDate = (selectedDate, now = new Date()) => {
  const selected = String(selectedDate || "").trim();
  const clock = getTaipeiClock(now);
  const reportDate = getCurrentTaipeiReportDate(now);
  const base = {
    selectedDate: selected,
    reportDate,
    calendarDate: clock.dateKey,
    taipeiTimeText: clock.timeText,
    isBackfill: false,
  };

  if (!isValidDateKey(selected)) return { ...base, allowed: false, status: "INVALID_DATE" };
  if (selected > reportDate) return { ...base, allowed: false, status: "FUTURE_DATE" };
  if (selected < reportDate) return { ...base, allowed: true, status: "BACKFILL", isBackfill: true };

  if (
    selected === clock.dateKey &&
    clock.hour >= REPORT_DAY_ROLLOVER_HOUR &&
    clock.hour < SAME_DAY_SUBMIT_START_HOUR
  ) {
    return { ...base, allowed: false, status: "SAME_DAY_BEFORE_CUTOFF" };
  }

  return { ...base, allowed: true, status: "CURRENT_REPORT_DATE" };
};

export const formatReportMonthDay = (dateKey) => {
  const match = DATE_KEY_RE.exec(String(dateKey || ""));
  if (!match) return String(dateKey || "");
  return `${Number(match[2])}/${Number(match[3])}`;
};

export const DAILY_REPORT_DATE_SAFETY = Object.freeze({
  timeZone: REPORT_TIME_ZONE,
  reportDayRolloverHour: REPORT_DAY_ROLLOVER_HOUR,
  sameDaySubmitStartHour: SAME_DAY_SUBMIT_START_HOUR,
});
