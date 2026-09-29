const DAY_MS = 86_400_000;

/** How far back a snapshot's time is moved before taking its UTC date. */
const SNAPSHOT_SHIFT_MS = 12 * 3_600_000;

/**
 * The day a snapshot stands for. The daily job runs just after midnight UTC, so
 * a snapshot taken before noon UTC closes the previous day; a later one (for
 * example a manual run in the afternoon) counts as today so far and is replaced
 * by the next scheduled run.
 */
export function snapshotDay(capturedAt: Date): string {
  return new Date(capturedAt.getTime() - SNAPSHOT_SHIFT_MS).toISOString().slice(0, 10);
}

export function shiftDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

/** Every day from start to end, both included. */
export function daySpan(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = shiftDays(day, 1)) days.push(day);
  return days;
}
