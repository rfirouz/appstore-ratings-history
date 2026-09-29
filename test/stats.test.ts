import assert from "node:assert/strict";
import { test } from "node:test";
import { countryDeltas, countrySummaries, dailySeries, impliedAverage } from "../src/stats.ts";
import type { RatingRow, RunRow } from "../src/types.ts";

const row = (day: string, country: string, ratings: number, average: number | null): RatingRow => ({ day, country, ratings, average });
const run = (day: string, failed: string[] = []): RunRow => ({ day, capturedAt: `${day}T00:37:00Z`, checked: 2, listed: 2, failed });

test("the average of new ratings comes from the change in total stars", () => {
  // 100 ratings at 4.5 = 450 stars; 110 at 4.5 = 495 stars; the 10 new ones average 4.5.
  assert.equal(impliedAverage(row("d1", "us", 100, 4.5), row("d2", "us", 110, 4.5)), 4.5);
  // 10 new one-star ratings pull 100 × 5.0 down to 510 / 110.
  assert.ok(Math.abs(impliedAverage(row("d1", "us", 100, 5), row("d2", "us", 110, 510 / 110))! - 1) < 1e-9);
  assert.equal(impliedAverage(row("d1", "us", 0, null), row("d2", "us", 3, 4)), 4);
  assert.equal(impliedAverage(row("d1", "us", 100, 4.5), row("d2", "us", 100, 4.5)), null);
});

test("a big drop is a reset and counts the ratings since it; a small drop is a removal", () => {
  const deltas = countryDeltas([
    row("2026-01-01", "us", 1000, 4.2),
    row("2026-01-02", "us", 12, 4.8),
    row("2026-01-01", "de", 500, 4),
    row("2026-01-02", "de", 497, 4),
  ]);
  const us = deltas.find((delta) => delta.country === "us")!;
  const de = deltas.find((delta) => delta.country === "de")!;
  assert.deepEqual([us.reset, us.newRatings, us.newAverage], [true, 12, 4.8]);
  assert.deepEqual([de.reset, de.newRatings, de.removed], [false, 0, 3]);
});

test("daily series adds countries, marks missed days and carries totals through failures", () => {
  const ratings = [
    row("2026-01-01", "us", 100, 4.5),
    row("2026-01-01", "de", 50, 4),
    row("2026-01-02", "us", 104, 4.5),
    row("2026-01-02", "de", 51, 4),
    // 2026-01-03 missed entirely
    row("2026-01-04", "us", 110, 4.5),
    // de failed on 2026-01-04
  ];
  const days = dailySeries({ ratings, runs: [run("2026-01-01"), run("2026-01-02"), run("2026-01-04", ["de"])] });
  assert.deepEqual(days.map((day) => day.day), ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  const [first, second, missed, fourth] = days;
  assert.equal(first!.newRatings, null);
  assert.equal(first!.ratings, 150);
  assert.equal(second!.newRatings, 5);
  assert.equal(second!.covers, 1);
  assert.equal(missed!.snapshot, false);
  assert.equal(missed!.newRatings, null);
  assert.equal(missed!.ratings, null);
  assert.equal(fourth!.newRatings, 6);
  assert.equal(fourth!.covers, 2);
  assert.deepEqual(fourth!.failed, ["de"]);
  assert.equal(fourth!.ratings, 161, "Germany keeps its last known count");
});

test("country filter and downloads line up per day", () => {
  const ratings = [row("2026-01-01", "us", 100, 4.5), row("2026-01-02", "us", 102, 4.5), row("2026-01-01", "de", 10, 4), row("2026-01-02", "de", 13, 4)];
  const downloads = [
    { day: "2026-01-02", country: "us", firstTime: 200, redownloads: 5, institutional: 30 },
    { day: "2026-01-02", country: "de", firstTime: 20, redownloads: 0, institutional: 0 },
  ];
  const all = dailySeries({ ratings, runs: [], downloads });
  assert.equal(all[1]!.downloads, 220);
  assert.equal(all[0]!.downloads, null);
  const us = dailySeries({ ratings, runs: [], downloads, country: "us" });
  assert.equal(us[1]!.newRatings, 2);
  assert.equal(us[1]!.downloads, 200);
  assert.equal(us[1]!.institutional, 30);
});

test("country summaries total the new ratings inside the range", () => {
  const ratings = [row("2026-01-01", "us", 100, 4.5), row("2026-01-02", "us", 102, 4.5), row("2026-01-03", "us", 110, 4.5), row("2026-01-01", "de", 10, 4)];
  const [us, de] = countrySummaries(ratings, "2026-01-03", "2026-01-03");
  assert.deepEqual([us!.code, us!.ratings, us!.newRatings], ["us", 110, 8]);
  assert.deepEqual([de!.code, de!.newRatings], ["de", 0]);
});
