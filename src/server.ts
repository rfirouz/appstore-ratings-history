import { execFileSync, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { countrySummaries, dailySeries, weightedAverage } from "./stats.ts";
import { appIds, openApp } from "./store.ts";
import { countryName } from "./storefronts.ts";
import type { AppPayload, AppSummary, RatingRow } from "./types.ts";

const DASHBOARD = fileURLToPath(new URL("../dashboard/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

type Options = { dataDir: string; port: number; open: boolean; pull: boolean };

function pullLatest(): void {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  } catch {
    return;
  }
  try {
    console.log("Pulling the latest snapshots…");
    execFileSync("git", ["pull", "--ff-only", "--quiet"], { stdio: ["ignore", "inherit", "pipe"], timeout: 60_000 });
  } catch (error) {
    const detail = String((error as { stderr?: Buffer }).stderr ?? "").trim().split("\n")[0];
    console.warn(`Couldn't pull the latest snapshots${detail ? ` (${detail})` : ""}. Showing the data already on this computer.`);
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

function latestByCountry(rows: RatingRow[]): RatingRow[] {
  const latest = new Map<string, RatingRow>();
  for (const row of rows) {
    const seen = latest.get(row.country);
    if (!seen || seen.day <= row.day) latest.set(row.country, row);
  }
  return [...latest.values()];
}

function appSummaries(dataDir: string): AppSummary[] {
  return appIds(dataDir).flatMap((id) => {
    const files = openApp(dataDir, id);
    const app = files.readApp();
    if (!app) return [];
    const ratings = files.readRatings();
    const latest = latestByCountry(ratings);
    return [{
      app,
      firstDay: ratings[0]?.day ?? null,
      lastDay: ratings.at(-1)?.day ?? null,
      countries: latest.length,
      ratings: latest.length ? latest.reduce((sum, row) => sum + row.ratings, 0) : null,
      average: weightedAverage(latest),
    }];
  });
}

function appPayload(dataDir: string, id: string, country: string | null): AppPayload | null {
  const files = openApp(dataDir, id);
  const app = files.readApp();
  if (!app) return null;
  const ratings = files.readRatings();
  const runs = files.readRuns();
  const reviews = files.readReviews();
  const downloads = files.readDownloads();
  return {
    app,
    days: dailySeries({ ratings, runs, reviews, downloads, country }),
    versions: files.readVersions(),
    countries: latestByCountry(ratings)
      .map((row) => ({ code: row.country, name: countryName(row.country), ratings: row.ratings }))
      .sort((a, b) => b.ratings - a.ratings || a.name.localeCompare(b.name)),
    lastRun: runs.at(-1) ?? null,
    hasReviews: reviews.length > 0,
    hasDownloads: downloads.length > 0,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const stripped = new Map<string, { mtime: number; code: string }>();

function sendStatic(res: ServerResponse, pathname: string): void {
  const path = resolve(DASHBOARD, "." + (pathname === "/" ? "/index.html" : pathname));
  const type = TYPES[extname(path)];
  if (!path.startsWith(DASHBOARD.endsWith(sep) ? DASHBOARD : DASHBOARD + sep) || !type) {
    res.writeHead(404).end("Not found");
    return;
  }
  let body: string;
  try {
    if (path.endsWith(".ts")) {
      const mtime = statSync(path).mtimeMs;
      const cached = stripped.get(path);
      body = cached?.mtime === mtime ? cached.code : stripTypeScriptTypes(readFileSync(path, "utf8"));
      stripped.set(path, { mtime, code: body });
    } else {
      body = readFileSync(path, "utf8");
    }
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function handler(dataDir: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] !== "api") return sendStatic(res, url.pathname);
      if (parts[1] !== "apps") return sendJson(res, 404, { error: "Not found" });
      if (parts.length === 2) return sendJson(res, 200, appSummaries(dataDir));
      const id = parts[2] ?? "";
      if (!/^\d+$/.test(id)) return sendJson(res, 404, { error: "Unknown app" });
      const country = url.searchParams.get("country") || null;
      if (parts.length === 3) {
        const payload = appPayload(dataDir, id, country);
        return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: "Unknown app" });
      }
      const files = openApp(dataDir, id);
      const from = url.searchParams.get("from") ?? "0000-00-00";
      const to = url.searchParams.get("to") ?? "9999-99-99";
      if (parts[3] === "countries") return sendJson(res, 200, countrySummaries(files.readRatings(), from, to));
      if (parts[3] === "reviews") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const rows = files
          .readReviews()
          .filter((row) => row.created.slice(0, 10) >= from && row.created.slice(0, 10) <= to && (!country || row.country === country));
        return sendJson(res, 200, rows.slice(0, limit));
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, 500, { error: (error as Error).message });
    }
  };
}

export async function startDashboard(options: Options): Promise<void> {
  if (options.pull) pullLatest();
  if (!appIds(options.dataDir).length) {
    console.log(`No snapshots in ${options.dataDir} yet. The dashboard will fill in after the first "collect" run.`);
  }
  const server = createServer(handler(options.dataDir));
  const port = await new Promise<number>((done, fail) => {
    let attempt = options.port;
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && attempt < options.port + 20) server.listen(++attempt, "127.0.0.1");
      else fail(error);
    });
    server.on("listening", () => done(attempt));
    server.listen(attempt, "127.0.0.1");
  });
  const url = `http://localhost:${port}/`;
  console.log(`Dashboard running at ${url} (press Ctrl+C to stop)`);
  if (options.open) openBrowser(url);
}
