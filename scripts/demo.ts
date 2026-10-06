/**
 * Writes made-up history for a pretend app into ./demo-data and opens the
 * dashboard on it, so the charts can be tried without waiting for snapshots.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { shiftDays } from "../src/days.ts";
import { startDashboard } from "../src/server.ts";
import { openApp } from "../src/store.ts";
import type { DownloadRow, RatingRow, ReviewRow } from "../src/types.ts";

const DIR = resolve("demo-data");
const ID = "100000001";
const DAYS = 400;
const END = shiftDays(new Date().toISOString().slice(0, 10), -1);
const START = shiftDays(END, -(DAYS - 1));

let seed = 7;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const poisson = (mean: number) => {
  let count = 0;
  for (let p = Math.exp(-mean), s = p, u = random(); u > s; count++) {
    p *= mean / (count + 1);
    s += p;
  }
  return count;
};

const COUNTRIES: [string, number, number][] = [
  ["us", 9, 4.6], ["gb", 3, 4.5], ["de", 2.4, 4.3], ["fr", 1.6, 4.4], ["ca", 1.4, 4.6], ["au", 1.1, 4.7],
  ["nl", 0.8, 4.2], ["jp", 0.7, 4.1], ["br", 0.6, 4.5], ["es", 0.5, 4.4], ["it", 0.4, 4.3], ["se", 0.3, 4.6],
];
const RELEASES = [
  { day: 18, version: "2.4.0", lift: 1.0, stars: 0, notes: "New handwriting worksheets and a calmer home screen." },
  { day: 61, version: "2.5.0", lift: 2.3, stars: 0.3, notes: "Rating prompt after finishing a lesson." },
  { day: 104, version: "2.5.1", lift: 2.1, stars: 0.25, notes: "Bug fixes." },
  { day: 170, version: "2.6.0", lift: 1.3, stars: -1.3, notes: "New subscription screen.", complaint: "The new subscription screen hides the free lessons." },
  { day: 181, version: "2.6.1", lift: 2.0, stars: 0.2, notes: "Undo the subscription screen change." },
  { day: 260, version: "3.0.0", lift: 2.8, stars: 0.35, notes: "Redesigned lessons." },
  { day: 330, version: "3.1.0", lift: 2.0, stars: -0.7, notes: "Dark mode and a new sign-in.", complaint: "The update logged me out and my progress is gone." },
  { day: 385, version: "3.2.0", lift: 3.0, stars: 0.35, notes: "Fixes sign-in. Cursive for left-handed writers." },
];
const MISSED = new Set([96, 97, 212]);
const FAILED = new Map([[300, ["jp"]], [329, ["jp", "br"]]]);

rmSync(DIR, { recursive: true, force: true });
const files = openApp(DIR, ID);
files.writeApp({ id: ID, name: "Demo App", seller: "Made-up data", bundleId: "com.example.demo", url: "", icon: "", genre: "Education" });

const state = new Map(COUNTRIES.map(([code, rate, stars]) => [code, { count: Math.round(rate * 400), sum: rate * 400 * stars }]));
const downloads: DownloadRow[] = [];
const reviews: ReviewRow[] = [];
for (let index = 0; index < DAYS; index++) {
  const day = shiftDays(START, index);
  const release = [...RELEASES].reverse().find((item) => item.day <= index);
  const lift = release?.lift ?? 1;
  const shift = release?.stars ?? 0;
  const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) ? 1.25 : 1;
  const rows: RatingRow[] = [];
  for (const [code, rate, stars] of COUNTRIES) {
    const current = state.get(code)!;
    const added = poisson(rate * lift * weekend);
    for (let i = 0; i < added; i++) current.sum += Math.min(5, Math.max(1, Math.round(stars + shift + (random() - 0.5) * 2.2)));
    current.count += added;
    if (code === "de" && index === 262) {
      current.count = poisson(3);
      current.sum = current.count * 4.6;
    }
    rows.push({ day, country: code, ratings: current.count, average: current.count ? Math.round((current.sum / current.count) * 1e5) / 1e5 : null });
    const installs = Math.round(rate * 55 * weekend * (0.85 + random() * 0.3));
    downloads.push({ day, country: code, firstTime: installs, redownloads: Math.round(installs * 0.12), institutional: code === "us" && index % 90 === 40 ? 600 : 0 });
    if (random() < 0.12 * rate) {
      const rating = Math.min(5, Math.max(1, Math.round(stars + shift + (random() - 0.6) * 3)));
      reviews.push({ id: `r${index}${code}`, created: `${day}T${String(8 + Math.floor(random() * 12)).padStart(2, "0")}:00:00.000Z`, country: code, rating, title: rating >= 4 ? "Lovely app" : "Needs work", body: rating >= 4 ? "My kids use it every day." : release?.complaint ?? "Some letters are hard to trace.", nickname: "someone" });
    }
  }
  if (MISSED.has(index)) continue;
  const failed = FAILED.get(index) ?? [];
  files.writeRatings(day, rows.filter((row) => !failed.includes(row.country)));
  files.appendRun({ day, capturedAt: `${shiftDays(day, 1)}T00:41:00.000Z`, checked: 175, listed: COUNTRIES.length - failed.length, failed });
}
files.writeVersions(RELEASES.map((item) => ({ version: item.version, released: shiftDays(START, item.day), firstSeen: shiftDays(START, item.day), notes: item.notes })));
files.writeDownloads(downloads.filter((row) => row.day <= shiftDays(END, -2)));
files.writeReviews(reviews);

console.log(`Wrote ${DAYS} days of made-up history to ${DIR}.`);
await startDashboard({ dataDir: DIR, port: 4321, open: !process.argv.includes("--no-open"), pull: false });
