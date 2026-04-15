import type { CampaignCalendarItem } from "../../../lib/api";

export type CalendarView = "month" | "week" | "list";

const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const endOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);

export const startOfWeek = (date: Date) => {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
};

export const endOfWeek = (date: Date) => new Date(startOfWeek(date).getTime() + 7 * DAY_MS - 1);

export const addMonths = (date: Date, months: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

export const addWeeks = (date: Date, weeks: number) => new Date(date.getTime() + weeks * 7 * DAY_MS);

export const windowForView = (view: CalendarView, anchor: Date) => {
  if (view === "week") {
    return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
};

export const daysBetweenInclusive = (from: Date, to: Date) => {
  const days: Date[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let current = start; current <= end; current += DAY_MS) {
    days.push(new Date(current));
  }
  return days;
};

export const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

export const toDatetimeLocal = (iso: string | null) => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const fromDatetimeLocal = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

export const warningLabel = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());

export const statusClassName = (status: CampaignCalendarItem["status"]) => {
  if (status === "ACTIVE") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "PENDING_APPROVAL") return "border-amber-300 bg-amber-50 text-amber-900";
  if (status === "ARCHIVED") return "border-stone-300 bg-stone-100 text-stone-600";
  return "border-sky-300 bg-sky-50 text-sky-900";
};

export const calendarGridPlacement = (item: CampaignCalendarItem, days: Date[]) => {
  if (!item.startAt || !item.endAt || days.length === 0) {
    return null;
  }
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const clampedStart = Math.max(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate())
  );
  const clampedEnd = Math.min(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate())
  );
  if (clampedEnd < clampedStart) {
    return null;
  }
  const startIndex = Math.floor((clampedStart - Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate())) / DAY_MS);
  const span = Math.floor((clampedEnd - clampedStart) / DAY_MS) + 1;
  return {
    gridColumn: `${startIndex + 1} / span ${span}`
  };
};
