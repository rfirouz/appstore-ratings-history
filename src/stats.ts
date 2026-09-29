import { daySpan, daysBetween } from "./days.ts";
import { countryName } from "./storefronts.ts";
import type { CountrySummary, DayPoint, DownloadRow, RatingRow, ReviewRow, RunRow } from "./types.ts";

/** A drop to half or less of the previous count is read as a reset of the rating summary. */
const RESET_SHARE = 0.5;

export type CountryDelta = {
  day: string;
  country: string;
  newRatings: number;
  /** Average stars of the new ratings, when it can be worked out. */
  newAverage: number | null;
  covers: number;
  reset: boolean;
  removed: number;
};

/**
 * Stars of the ratings added between two snapshots, from the change in total
 * stars (average × count). Apple rounds the average to five decimals, so values
 * far outside 1–5 are noise and are dropped.
 */
export function impliedAverage(before: RatingRow, after: RatingRow): number | null {
  const added = after.ratings - before.ratings;
  if (added <= 0 || after.average == null) return null;
  if (before.ratings > 0 && before.average == null) return null;
  const value = (after.average * after.ratings - (before.average ?? 0) * before.ratings) / added;
  if (value < 0.5 || value > 5.5) return null;
  return Math.min(5, Math.max(1, value));
}

export function countryDeltas(rows: RatingRow[]): CountryDelta[] {
  const byCountry = new Map<string, RatingRow[]>();
  for (const row of rows) {
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }
  const deltas: CountryDelta[] = [];
  for (const [country, list] of byCountry) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1]!;
      const after = list[i]!;
      const covers = daysBetween(before.day, after.day);
      if (after.ratings >= before.ratings) {
        deltas.push({
          day: after.day,
          country,
          newRatings: after.ratings - before.ratings,
          newAverage: impliedAverage(before, after),
          covers,
          reset: false,
          removed: 0,
        });
      } else if (after.ratings <= before.ratings * RESET_SHARE) {
        deltas.push({
          day: after.day,
          country,
          newRatings: after.ratings,
          newAverage: after.ratings > 0 ? after.average : null,
          covers,
          reset: true,
          removed: 0,
        });
      } else {
        deltas.push({ day: after.day, country, newRatings: 0, newAverage: null, covers, reset: false, removed: before.ratings - after.ratings });
      }
    }
  }
  return deltas;
}

export type SeriesInput = {
  ratings: RatingRow[];
  runs: RunRow[];
  downloads?: DownloadRow[];
  reviews?: ReviewRow[];
  /** Two-letter country code; all countries when missing. */
  country?: string | null;
};

export function dailySeries(input: SeriesInput): DayPoint[] {
  const country = input.country || null;
  const ratings = country ? input.ratings.filter((row) => row.country === country) : input.ratings;
  const snapshotDays = new Set([...input.ratings.map((row) => row.day), ...input.runs.map((run) => run.day)]);
  if (!snapshotDays.size) return [];
  const ordered = [...snapshotDays].sort();
  const days = daySpan(ordered[0]!, ordered.at(-1)!);

  const rowsByDay = groupBy(ratings, (row) => row.day);
  const deltasByDay = groupBy(countryDeltas(ratings), (delta) => delta.day);
  const lastRunByDay = new Map(input.runs.map((run) => [run.day, run]));

  const downloadDays = new Set((input.downloads ?? []).map((row) => row.day));
  const downloads = new Map<string, { firstTime: number; institutional: number }>();
  for (const row of input.downloads ?? []) {
    if (country && row.country !== country) continue;
    const total = downloads.get(row.day) ?? { firstTime: 0, institutional: 0 };
    total.firstTime += row.firstTime;
    total.institutional += row.institutional;
    downloads.set(row.day, total);
  }

  const reviews = new Map<string, { count: number; stars: number }>();
  for (const row of input.reviews ?? []) {
    if (country && row.country !== country) continue;
    const day = row.created.slice(0, 10);
    const total = reviews.get(day) ?? { count: 0, stars: 0 };
    total.count += 1;
    total.stars += row.rating;
    reviews.set(day, total);
  }

  const known = new Map<string, RatingRow>();
  return days.map((day): DayPoint => {
    const today = rowsByDay.get(day) ?? [];
    for (const row of today) known.set(row.country, row);
    const snapshot = snapshotDays.has(day);
    const current = [...known.values()];

    const deltas = deltasByDay.get(day) ?? [];
    const counted = deltas.filter((delta) => delta.newAverage != null && delta.newRatings > 0);
    const sample = counted.reduce((sum, delta) => sum + delta.newRatings, 0);

    const seen = new Set(today.map((row) => row.country));
    const failed = (lastRunByDay.get(day)?.failed ?? []).filter(
      (code) => !seen.has(code) && (!country || code === country),
    );

    const download = downloadDays.has(day) ? (downloads.get(day) ?? { firstTime: 0, institutional: 0 }) : null;
    const review = reviews.get(day);

    return {
      day,
      ratings: snapshot && current.length ? current.reduce((sum, row) => sum + row.ratings, 0) : null,
      average: snapshot ? weightedAverage(current) : null,
      newRatings: deltas.length ? deltas.reduce((sum, delta) => sum + delta.newRatings, 0) : null,
      newAverage: sample ? counted.reduce((sum, delta) => sum + (delta.newAverage ?? 0) * delta.newRatings, 0) / sample : null,
      newAverageSample: sample,
      covers: deltas.reduce((most, delta) => Math.max(most, delta.covers), deltas.length ? 1 : 0),
      snapshot,
      failed,
      resets: deltas.filter((delta) => delta.reset).map((delta) => delta.country),
      removed: deltas.reduce((sum, delta) => sum + delta.removed, 0),
      downloads: download ? download.firstTime : null,
      institutional: download ? download.institutional : null,
      reviews: review?.count ?? 0,
      reviewStars: review?.stars ?? 0,
    };
  });
}

/** Per-country totals as of `to`, and new ratings between `from` and `to` (both included). */
export function countrySummaries(rows: RatingRow[], from: string, to: string): CountrySummary[] {
  const latest = new Map<string, RatingRow>();
  for (const row of rows) {
    if (row.day > to) continue;
    const seen = latest.get(row.country);
    if (!seen || seen.day < row.day) latest.set(row.country, row);
  }
  const added = new Map<string, { count: number; stars: number; sample: number }>();
  for (const delta of countryDeltas(rows)) {
    if (delta.day < from || delta.day > to) continue;
    const total = added.get(delta.country) ?? { count: 0, stars: 0, sample: 0 };
    total.count += delta.newRatings;
    if (delta.newAverage != null) {
      total.stars += delta.newAverage * delta.newRatings;
      total.sample += delta.newRatings;
    }
    added.set(delta.country, total);
  }
  return [...latest.values()]
    .map((row) => {
      const change = added.get(row.country);
      return {
        code: row.country,
        name: countryName(row.country),
        ratings: row.ratings,
        average: row.average,
        newRatings: change?.count ?? 0,
        newAverage: change?.sample ? change.stars / change.sample : null,
      };
    })
    .sort((a, b) => b.newRatings - a.newRatings || b.ratings - a.ratings || a.name.localeCompare(b.name));
}

export function weightedAverage(rows: RatingRow[]): number | null {
  const weight = rows.reduce((sum, row) => sum + (row.average == null ? 0 : row.ratings), 0);
  if (!weight) return null;
  return rows.reduce((sum, row) => sum + (row.average ?? 0) * row.ratings, 0) / weight;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const list = groups.get(name) ?? [];
    list.push(item);
    groups.set(name, list);
  }
  return groups;
}
