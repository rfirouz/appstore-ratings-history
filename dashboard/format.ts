export type Bucket = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export function shiftDays(day: string, delta: number): string {
  return iso(ms(day) + delta * DAY_MS);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((ms(end) - ms(start)) / DAY_MS);
}

export function periodStart(day: string, bucket: Bucket): string {
  if (bucket === "day") return day;
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(ms(day)).getUTCDay();
  return shiftDays(day, -(weekday === 0 ? 6 : weekday - 1));
}

/** First day after the period that starts on `day`. */
export function periodEnd(day: string, bucket: Bucket): string {
  if (bucket === "day") return shiftDays(day, 1);
  if (bucket === "week") return shiftDays(day, 7);
  const date = new Date(ms(day));
  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return iso(date.getTime());
}

export function periodLabel(day: string, bucket: Bucket): string {
  const date = new Date(ms(day));
  if (bucket === "month") return date.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const text = date.toLocaleDateString("en", {
    weekday: bucket === "day" ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return bucket === "week" ? `Week of ${text}` : text;
}

export function shortDate(day: string): string {
  return new Date(ms(day)).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
}

export function formatStars(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return value.toFixed(2);
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

export function signed(value: number, format: (value: number) => string): string {
  if (value === 0) return format(0);
  return (value > 0 ? "+" : "−") + format(Math.abs(value));
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${formatInt(count)} ${count === 1 ? word : many}`;
}
