import assert from "node:assert/strict";
import { test } from "node:test";
import { countryDeltas, countrySummaries, dailySeries, impliedAverage, spreadDelta } from "../src/stats.ts";
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
  assert.equal(second!.missedShare, false);
  assert.equal(missed!.snapshot, false);
  assert.equal(missed!.newRatings, 3, "the 6 new US ratings are shared with the missed day");
  assert.equal(missed!.ratings, null);
  assert.equal(fourth!.newRatings, 3);
  assert.equal(fourth!.missedShare, true);
  assert.deepEqual(fourth!.estimated, []);
  assert.deepEqual(fourth!.failed, ["de"]);
  assert.equal(fourth!.ratings, 161, "Germany keeps its last known count");
});

test("a change spanning several days is split evenly, with leftovers on the latest days", () => {
  const [delta] = countryDeltas([row("2026-01-01", "jp", 200, 4), row("2026-01-04", "jp", 211, 4)]);
  assert.deepEqual(spreadDelta(delta!), [
    { day: "2026-01-02", newRatings: 3 },
    { day: "2026-01-03", newRatings: 4 },
    { day: "2026-01-04", newRatings: 4 },
  ]);
});

test("a failed check is estimated across the days it missed, so a release doesn't get the catch-up", () => {
  const ratings = [
    row("2026-01-01", "us", 100, 4.5),
    row("2026-01-02", "us", 101, 4.5),
    row("2026-01-03", "us", 102, 4.5),
    row("2026-01-01", "jp", 200, 4),
    // jp failed on 2026-01-02; a release went live on 2026-01-03
    row("2026-01-03", "jp", 211, 4),
  ];
  const days = dailySeries({ ratings, runs: [run("2026-01-01"), run("2026-01-02", ["jp"]), run("2026-01-03")] });
  const [, failedDay, release] = days;
  assert.equal(failedDay!.newRatings, 6, "1 from the US plus Japan's share of 5");
  assert.deepEqual(failedDay!.estimated, ["jp"]);
  assert.deepEqual(failedDay!.failed, ["jp"]);
  assert.equal(failedDay!.missedShare, false);
  assert.equal(release!.newRatings, 7, "1 from the US plus Japan's share of 6, not all 11");
  assert.deepEqual(release!.estimated, ["jp"]);
  assert.ok(Math.abs(release!.newAverage! - (4.5 * 1 + 4 * 6) / 7) < 1e-9, "Japan's share keeps its average");

  const [jp] = countrySummaries(ratings, "2026-01-03", "2026-01-03");
  assert.deepEqual([jp!.code, jp!.newRatings], ["jp", 6]);
});

test("a country that failed on the latest run has no share yet", () => {
  const ratings = [row("2026-01-01", "jp", 200, 4), row("2026-01-01", "us", 100, 4.5), row("2026-01-02", "us", 102, 4.5)];
  const [, last] = dailySeries({ ratings, runs: [run("2026-01-01"), run("2026-01-02", ["jp"])] });
  assert.equal(last!.newRatings, 2);
  assert.deepEqual(last!.estimated, []);
  assert.deepEqual(last!.failed, ["jp"]);
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
