import type { Config } from "./config.ts";
import { snapshotDay } from "./days.ts";
import { log } from "./log.ts";
import { weightedAverage } from "./stats.ts";
import { openApp } from "./store.ts";
import type { AppInfo, RatingRow } from "./types.ts";

const LOOKUP = "https://itunes.apple.com/lookup";
const IDS_PER_REQUEST = 50;
const RETRY_WAITS_MS = [5_000, 15_000];
const SECOND_PASS_WAIT_MS = 30_000;
/** After this many countries fail in a row, Apple is refusing requests and the run stops early. */
const MAX_FAILURES_IN_A_ROW = 8;

type LookupResult = {
  trackId: number;
  trackName?: string;
  sellerName?: string;
  bundleId?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  version?: string;
  currentVersionReleaseDate?: string;
  releaseNotes?: string;
  averageUserRating?: number;
  userRatingCount?: number;
};

export type Deps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

export const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => new Date(),
};

class RetryableError extends Error {}

async function lookupOnce(deps: Deps, ids: string[], country: string): Promise<LookupResult[]> {
  const url = `${LOOKUP}?id=${ids.join(",")}&country=${country}`;
  let response: Response;
  try {
    response = await deps.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new RetryableError(`network error: ${(error as Error).message}`);
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new RetryableError(`HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { results?: LookupResult[] };
  return (body.results ?? []).filter((item) => typeof item.trackId === "number");
}

async function lookup(deps: Deps, ids: string[], country: string, waits: number[]): Promise<LookupResult[]> {
  const results: LookupResult[] = [];
  for (let start = 0; start < ids.length; start += IDS_PER_REQUEST) {
    const chunk = ids.slice(start, start + IDS_PER_REQUEST);
    for (let attempt = 0; ; attempt++) {
      try {
        results.push(...(await lookupOnce(deps, chunk, country)));
        break;
      } catch (error) {
        const wait = waits[attempt];
        if (!(error instanceof RetryableError) || wait == null) throw error;
        await deps.sleep(wait);
      }
    }
  }
  return results;
}

export type AppRun = {
  id: string;
  name: string;
  day: string;
  listed: number;
  ratings: number;
  average: number | null;
  change: number | null;
  newVersion: string | null;
};

export type LookupRun = { day: string; checked: number; failed: string[]; apps: AppRun[] };

export async function collectLookups(config: Config, deps: Deps = defaultDeps): Promise<LookupRun> {
  const capturedAt = deps.now();
  const day = snapshotDay(capturedAt);
  const found = new Map<string, Map<string, LookupResult>>(config.apps.map((id) => [id, new Map()]));
  const failed = new Set<string>();

  const check = async (country: string, waits: number[]): Promise<boolean> => {
    try {
      for (const result of await lookup(deps, config.apps, country, waits)) {
        found.get(String(result.trackId))?.set(country, result);
      }
      failed.delete(country);
      return true;
    } catch (error) {
      failed.add(country);
      log.info(`  ${country}: ${(error as Error).message}`);
      return false;
    }
  };

  log.info(`Checking ${config.apps.length} app(s) in ${config.countries.length} countries for ${day}…`);
  let inARow = 0;
  for (const [index, country] of config.countries.entries()) {
    if (inARow >= MAX_FAILURES_IN_A_ROW) {
      failed.add(country);
      continue;
    }
    if (index > 0) await deps.sleep(config.requestDelayMs);
    inARow = (await check(country, RETRY_WAITS_MS)) ? 0 : inARow + 1;
  }
  if (inARow >= MAX_FAILURES_IN_A_ROW) {
    log.warn(`Apple refused ${MAX_FAILURES_IN_A_ROW} countries in a row, so the rest were skipped. This is usually temporary.`);
  } else if (failed.size) {
    log.info(`Retrying ${failed.size} countries that failed…`);
    await deps.sleep(SECOND_PASS_WAIT_MS);
    for (const country of [...failed]) {
      await check(country, []);
      await deps.sleep(config.requestDelayMs);
    }
  }
  const failedList = [...failed].sort();

  const apps: AppRun[] = [];
  for (const id of config.apps) {
    const results = found.get(id) ?? new Map<string, LookupResult>();
    const files = openApp(config.dataDir, id);
    if (results.size === 0) {
      log.warn(`App ${id} was not found in any country checked. Check that it is the numeric App Store ID and that the app is live.`);
      continue;
    }

    const previous = files.readRatings();
    const rows: RatingRow[] = [...results.entries()].map(([country, item]) => ({
      day,
      country,
      ratings: item.userRatingCount ?? 0,
      average: item.userRatingCount ? (item.averageUserRating ?? null) : null,
    }));
    files.writeRatings(day, rows);
    files.appendRun({
      day,
      capturedAt: capturedAt.toISOString(),
      checked: config.countries.length,
      listed: rows.length,
      failed: failedList,
    });

    const main = results.get("us") ?? [...results.values()][0]!;
    const info: AppInfo = {
      id,
      name: main.trackName ?? id,
      seller: main.sellerName ?? "",
      bundleId: main.bundleId ?? "",
      url: (main.trackViewUrl ?? "").split("?")[0] ?? "",
      icon: main.artworkUrl512 ?? main.artworkUrl100 ?? "",
      genre: main.primaryGenreName ?? "",
    };
    files.writeApp(info);

    let newVersion: string | null = null;
    const versions = files.readVersions();
    if (main.version && !versions.some((row) => row.version === main.version)) {
      versions.push({
        version: main.version,
        released: (main.currentVersionReleaseDate ?? "").slice(0, 10),
        firstSeen: day,
        notes: (main.releaseNotes ?? "").trim(),
      });
      files.writeVersions(versions);
      newVersion = main.version;
    }

    const total = rows.reduce((sum, row) => sum + row.ratings, 0);
    const lastDay = previous.filter((row) => row.day < day).at(-1)?.day;
    let change: number | null = null;
    if (lastDay) {
      const before = new Map(previous.filter((row) => row.day === lastDay).map((row) => [row.country, row.ratings]));
      change = rows.reduce((sum, row) => (before.has(row.country) ? sum + row.ratings - (before.get(row.country) ?? 0) : sum), 0);
    }
    apps.push({ id, name: info.name, day, listed: rows.length, ratings: total, average: weightedAverage(rows), change, newVersion });
  }

  return { day, checked: config.countries.length, failed: failedList, apps };
}
