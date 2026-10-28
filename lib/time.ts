export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Shanghai";

export interface LocalParts {
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  minutes: number;
  weekday: number; // ISO: 1=Monday ... 7=Sunday
}

const WEEKDAY_CN = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAY_SHORT = ["", "一", "二", "三", "四", "五", "六", "日"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getLocalParts(date: Date = new Date()): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  return {
    date: dateStr,
    year,
    month,
    day,
    hour,
    minute,
    second,
    minutes: hour * 60 + minute,
    weekday: weekdayOfDate(dateStr),
  };
}

export function weekdayOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_CN[weekday] || "";
}

export function weekdayShort(weekday: number): string {
  return WEEKDAY_SHORT[weekday] || "";
}

export function pad2(n: number): string {
  return pad(n);
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function timeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`无效时间: ${value}`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`无效时间: ${value}`);
  return h * 60 + m;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Convert a wall-clock time in the app timezone to a real instant. */
export function zonedDateTimeToUtc(dateStr: string, timeStr = "00:00", second = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, second);
  let offset = timezoneOffsetMs(new Date(utcGuess), APP_TIMEZONE);
  let result = utcGuess - offset;
  offset = timezoneOffsetMs(new Date(result), APP_TIMEZONE);
  result = utcGuess - offset;
  return new Date(result);
}

export function localDateBounds(dateStr: string): { start: string; endExclusive: string } {
  return {
    start: zonedDateTimeToUtc(dateStr, "00:00").toISOString(),
    endExclusive: zonedDateTimeToUtc(addDays(dateStr, 1), "00:00").toISOString(),
  };
}

export function todayLocal(date: Date = new Date()): string {
  return getLocalParts(date).date;
}

export function isoToLocalDate(iso: string): string {
  return getLocalParts(new Date(iso)).date;
}

export function formatDateTime(value: string | Date | null | undefined, opts?: { dateOnly?: boolean; seconds?: boolean }): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = getLocalParts(date);
  if (opts?.dateOnly) return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}${opts?.seconds ? `:${pad(parts.second)}` : ""}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  return formatDateTime(value, { dateOnly: true });
}

export function formatShortDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = getLocalParts(date);
  return `${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseDateInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式应为 YYYY-MM-DD");
  return value;
}

export function timeRangeLabel(startMinute: number, endMinute: number): string {
  return `${minutesToTime(startMinute)}–${minutesToTime(endMinute)}`;
}

export function humanRange(startDate: string, endDate: string | null): string {
  if (!endDate) return `${startDate} 起长期有效`;
  return `${startDate} 至 ${endDate}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(iso);
}

export function listDateRange(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 400) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}
