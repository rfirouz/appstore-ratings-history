import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";
import { collectLookups, type Deps } from "../src/lookup.ts";
import { openApp } from "../src/store.ts";

type Listing = Record<string, { count: number; average: number; version?: string }>;

function fakeApple(byCountry: Record<string, Listing | "fail">, now: string): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    now: () => new Date(now),
    sleep: async () => {},
    fetch: async (input) => {
      const url = new URL(String(input));
      const country = url.searchParams.get("country") ?? "";
      calls.push(country);
      const listing = byCountry[country];
      if (listing === "fail") return new Response("rate limited", { status: 403 });
      const results = Object.entries(listing ?? {}).map(([id, item]) => ({
        trackId: Number(id),
        trackName: `App ${id}`,
        sellerName: "Seller",
        version: item.version ?? "1.0",
        currentVersionReleaseDate: "2026-01-01T10:00:00Z",
        releaseNotes: "Fixes",
        userRatingCount: item.count,
        averageUserRating: item.average,
      }));
      return Response.json({ resultCount: results.length, results });
    },
  };
}

test("collect saves one row per listed country and a run log, and replaces a same-day rerun", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ratings-"));
  try {
    const config = { ...readConfig({ APP_IDS: "111111, 222222", COUNTRIES: "us,de,fr", REQUEST_DELAY_MS: "0" }), dataDir: dir };
    const first = fakeApple(
      { us: { "111111": { count: 10, average: 4.5 }, "222222": { count: 3, average: 5 } }, de: { "111111": { count: 0, average: 0 } }, fr: "fail" },
      "2026-03-02T00:40:00Z",
    );
    const run = await collectLookups(config, first);
    assert.equal(run.day, "2026-03-01");
    assert.deepEqual(run.failed, ["fr"]);
    assert.equal(first.calls.filter((country) => country === "fr").length, 4, "three tries in the first pass, one in the retry pass");

    const app = openApp(dir, "111111");
    assert.deepEqual(app.readRatings(), [
      { day: "2026-03-01", country: "de", ratings: 0, average: null },
      { day: "2026-03-01", country: "us", ratings: 10, average: 4.5 },
    ]);
    assert.equal(app.readApp()?.name, "App 111111");
    assert.equal(app.readVersions()[0]?.version, "1.0");
    assert.deepEqual(app.readRuns()[0]?.failed, ["fr"]);

    const rerun = fakeApple({ us: { "111111": { count: 12, average: 4.5, version: "1.1" } }, de: {}, fr: { "111111": { count: 7, average: 4 } } }, "2026-03-02T08:00:00Z");
    const second = await collectLookups(config, rerun);
    assert.equal(second.day, "2026-03-01");
    assert.deepEqual(
      app.readRatings().map((row) => [row.country, row.ratings]),
      [["de", 0], ["fr", 7], ["us", 12]],
      "same-day rerun replaces what it fetched and keeps the rest",
    );
    assert.deepEqual(app.readVersions().map((row) => row.version), ["1.0", "1.1"]);
    assert.equal(second.apps.find((item) => item.id === "222222"), undefined, "an app missing everywhere is reported, not saved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collect stops early when Apple refuses every country", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ratings-"));
  try {
    const config = { ...readConfig({ APP_IDS: "111111", REQUEST_DELAY_MS: "0" }), dataDir: dir };
    const apple = fakeApple(Object.fromEntries(config.countries.map((code) => [code, "fail" as const])), "2026-03-02T00:40:00Z");
    const run = await collectLookups(config, apple);
    assert.equal(run.failed.length, config.countries.length);
    assert.equal(apple.calls.length, 8 * 3, "eight countries with three tries each, then it stops");
    assert.equal(run.apps.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
