import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAppIds, readConfig } from "../src/config.ts";
import { formatCsv, parseCsv } from "../src/csv.ts";
import { daySpan, snapshotDay } from "../src/days.ts";
import { STOREFRONTS, countryCode } from "../src/storefronts.ts";

test("CSV round-trips commas, quotes and line breaks", () => {
  const rows = [{ id: "1", body: 'Great, "really"\nsecond line' }, { id: "2", body: "" }];
  assert.deepEqual(parseCsv(formatCsv(["id", "body"], rows)), rows);
});

test("a snapshot shortly after midnight UTC closes the previous day", () => {
  assert.equal(snapshotDay(new Date("2026-09-29T00:37:00Z")), "2026-09-28");
  assert.equal(snapshotDay(new Date("2026-09-29T09:50:00Z")), "2026-09-28");
  assert.equal(snapshotDay(new Date("2026-09-29T15:00:00Z")), "2026-09-29");
});

test("daySpan includes both ends and crosses months", () => {
  assert.deepEqual(daySpan("2026-02-27", "2026-03-01"), ["2026-02-27", "2026-02-28", "2026-03-01"]);
});

test("app IDs can be pasted as numbers, id-prefixed or as store links", () => {
  const { ids, invalid } = parseAppIds("1512640380, id284882215\nhttps://apps.apple.com/us/app/writey/id1234567890?uo=4 writey");
  assert.deepEqual(ids, ["1512640380", "284882215", "1234567890"]);
  assert.deepEqual(invalid, ["writey"]);
});

test("country list uses unique two- and three-letter codes", () => {
  assert.ok(STOREFRONTS.length >= 170);
  assert.equal(new Set(STOREFRONTS.map((item) => item.code)).size, STOREFRONTS.length);
  assert.equal(new Set(STOREFRONTS.map((item) => item.alpha3)).size, STOREFRONTS.length);
  assert.ok(STOREFRONTS.every((item) => /^[a-z]{2}$/.test(item.code) && /^[A-Z]{3}$/.test(item.alpha3) && item.name));
  assert.equal(countryCode("USA"), "us");
  assert.equal(countryCode("GB"), "gb");
});

test("config falls back to all countries and warns about half-set keys", () => {
  const config = readConfig({ APP_IDS: "1512640380", ASC_KEY_ID: "ABC" });
  assert.equal(config.countries.length, STOREFRONTS.length);
  assert.equal(config.asc, null);
  assert.match(config.warnings.join(" "), /partly configured/);
  assert.deepEqual(readConfig({ COUNTRIES: "us, DEU, xx" }).countries, ["us", "de"]);
});
