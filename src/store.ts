import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatCsv, parseCsv, type Row } from "./csv.ts";
import type { AppInfo, DownloadRow, RatingRow, ReviewRow, RunRow, VersionRow } from "./types.ts";

const RATING_COLUMNS = ["day", "country", "ratings", "average"] as const;
const RUN_COLUMNS = ["day", "captured_at", "checked", "listed", "failed"] as const;
const VERSION_COLUMNS = ["version", "released", "first_seen", "notes"] as const;
const REVIEW_COLUMNS = ["id", "created", "country", "rating", "title", "body", "nickname"] as const;
const DOWNLOAD_COLUMNS = ["day", "country", "first_time", "redownloads", "institutional"] as const;

export type ReportState = { requestId: string | null; processed: string[] };

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRows(path: string): Row[] {
  return existsSync(path) ? parseCsv(readFileSync(path, "utf8")) : [];
}

function writeRows(path: string, columns: readonly string[], rows: Row[]): void {
  writeFileSync(path, formatCsv(columns, rows));
}

export function appIds(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name) && existsSync(join(root, entry.name, "app.json")))
    .map((entry) => entry.name)
    .sort();
}

export function openApp(root: string, id: string) {
  const dir = join(root, id);
  const privateDir = join(dir, "private");
  const ensure = (path: string) => mkdirSync(path, { recursive: true });

  const ratingFiles = () =>
    existsSync(dir) ? readdirSync(dir).filter((name) => /^ratings-\d{4}\.csv$/.test(name)).sort() : [];

  return {
    dir,
    privateDir,

    readApp(): AppInfo | null {
      const path = join(dir, "app.json");
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as AppInfo) : null;
    },

    writeApp(info: AppInfo): void {
      ensure(dir);
      writeFileSync(join(dir, "app.json"), JSON.stringify(info, null, 2) + "\n");
    },

    readRatings(): RatingRow[] {
      return ratingFiles().flatMap((name) =>
        readRows(join(dir, name)).map((row) => ({
          day: row.day ?? "",
          country: row.country ?? "",
          ratings: num(row.ratings),
          average: row.average ? num(row.average) : null,
        })),
      );
    },

    /** Saves one day's rows; a country already saved for that day is replaced. */
    writeRatings(day: string, rows: RatingRow[]): void {
      ensure(dir);
      const path = join(dir, `ratings-${day.slice(0, 4)}.csv`);
      const replaced = new Set(rows.map((row) => row.country));
      const kept = readRows(path).filter((row) => !(row.day === day && replaced.has(row.country ?? "")));
      const added = rows.map((row) => ({
        day,
        country: row.country,
        ratings: String(row.ratings),
        average: row.average == null ? "" : String(row.average),
      }));
      const all = [...kept, ...added].sort(
        (a, b) => (a.day ?? "").localeCompare(b.day ?? "") || (a.country ?? "").localeCompare(b.country ?? ""),
      );
      writeRows(path, RATING_COLUMNS, all);
    },

    readRuns(): RunRow[] {
      return readRows(join(dir, "runs.csv")).map((row) => ({
        day: row.day ?? "",
        capturedAt: row.captured_at ?? "",
        checked: num(row.checked),
        listed: num(row.listed),
        failed: (row.failed ?? "").split(" ").filter(Boolean),
      }));
    },

    appendRun(run: RunRow): void {
      ensure(dir);
      const path = join(dir, "runs.csv");
      const rows = readRows(path);
      rows.push({
        day: run.day,
        captured_at: run.capturedAt,
        checked: String(run.checked),
        listed: String(run.listed),
        failed: run.failed.join(" "),
      });
      writeRows(path, RUN_COLUMNS, rows);
    },

    readVersions(): VersionRow[] {
      return readRows(join(dir, "versions.csv")).map((row) => ({
        version: row.version ?? "",
        released: row.released ?? "",
        firstSeen: row.first_seen ?? "",
        notes: row.notes ?? "",
      }));
    },

    writeVersions(rows: VersionRow[]): void {
      ensure(dir);
      writeRows(
        join(dir, "versions.csv"),
        VERSION_COLUMNS,
        rows.map((row) => ({ version: row.version, released: row.released, first_seen: row.firstSeen, notes: row.notes })),
      );
    },

    hasPrivate(name: "reviews" | "downloads"): boolean {
      return existsSync(join(privateDir, `${name}.csv`));
    },

    readReviews(): ReviewRow[] {
      return readRows(join(privateDir, "reviews.csv")).map((row) => ({
        id: row.id ?? "",
        created: row.created ?? "",
        country: row.country ?? "",
        rating: num(row.rating),
        title: row.title ?? "",
        body: row.body ?? "",
        nickname: row.nickname ?? "",
      }));
    },

    writeReviews(rows: ReviewRow[]): void {
      ensure(privateDir);
      const sorted = [...rows].sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
      writeRows(
        join(privateDir, "reviews.csv"),
        REVIEW_COLUMNS,
        sorted.map((row) => ({ ...row, rating: String(row.rating) })),
      );
    },

    readDownloads(): DownloadRow[] {
      return readRows(join(privateDir, "downloads.csv")).map((row) => ({
        day: row.day ?? "",
        country: row.country ?? "",
        firstTime: num(row.first_time),
        redownloads: num(row.redownloads),
        institutional: num(row.institutional),
      }));
    },

    writeDownloads(rows: DownloadRow[]): void {
      ensure(privateDir);
      const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.country.localeCompare(b.country));
      writeRows(
        join(privateDir, "downloads.csv"),
        DOWNLOAD_COLUMNS,
        sorted.map((row) => ({
          day: row.day,
          country: row.country,
          first_time: String(row.firstTime),
          redownloads: String(row.redownloads),
          institutional: String(row.institutional),
        })),
      );
    },

    readReportState(): ReportState {
      const path = join(privateDir, "reports.json");
      if (!existsSync(path)) return { requestId: null, processed: [] };
      return JSON.parse(readFileSync(path, "utf8")) as ReportState;
    },

    writeReportState(state: ReportState): void {
      ensure(privateDir);
      writeFileSync(join(privateDir, "reports.json"), JSON.stringify(state, null, 2) + "\n");
    },
  };
}

export type AppFiles = ReturnType<typeof openApp>;
