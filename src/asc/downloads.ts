import type { AppFiles } from "../store.ts";
import { countryCode } from "../storefronts.ts";
import type { DownloadRow } from "../types.ts";
import { AscError, type AscClient } from "./client.ts";

const REPORT_NAME = "app downloads standard";

type Item = { id: string; attributes?: Record<string, unknown> };

const norm = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Sums an "App Downloads Standard" TSV into first-time downloads and redownloads per day and country. */
export function aggregateDownloads(tsv: string, appId?: string): DownloadRow[] {
  const lines = tsv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() ?? "").split("\t").map(norm);
  const column = (name: string) => header.indexOf(name);
  const at = {
    date: column("date"),
    app: column("app_apple_identifier"),
    type: column("download_type"),
    source: column("source_type"),
    territory: column("territory"),
    counts: column("counts"),
  };
  const totals = new Map<string, DownloadRow>();
  for (const line of lines) {
    const cells = line.split("\t");
    const cell = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
    const day = cell(at.date).slice(0, 10);
    if (!day) continue;
    if (appId && at.app >= 0 && cell(at.app) && cell(at.app) !== appId) continue;
    const type = cell(at.type).toLowerCase();
    const count = Number(cell(at.counts)) || 0;
    const country = countryCode(cell(at.territory) || "zz");
    const key = `${day}|${country}`;
    const row = totals.get(key) ?? { day, country, firstTime: 0, redownloads: 0, institutional: 0 };
    if (type.includes("first")) {
      if (cell(at.source).toLowerCase().includes("institutional")) row.institutional += count;
      else row.firstTime += count;
    } else if (type.includes("redownload")) {
      row.redownloads += count;
    } else {
      continue;
    }
    totals.set(key, row);
  }
  return [...totals.values()];
}

/**
 * Apple sometimes sends a day again in a later report. A whole day is replaced
 * when the newer copy is at least as large, so a partial copy never wipes it.
 */
export function mergeDownloads(existing: DownloadRow[], incoming: DownloadRow[]): DownloadRow[] {
  const dayTotal = (rows: DownloadRow[]) => {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.day, (totals.get(row.day) ?? 0) + row.firstTime + row.redownloads + row.institutional);
    return totals;
  };
  const before = dayTotal(existing);
  const after = dayTotal(incoming);
  const replace = new Set([...after].filter(([day, total]) => total >= (before.get(day) ?? 0)).map(([day]) => day));
  return [...existing.filter((row) => !replace.has(row.day)), ...incoming.filter((row) => replace.has(row.day))];
}

async function ongoingRequest(client: AscClient, appId: string, known: string | null): Promise<{ id: string; created: boolean }> {
  const listing = await client.get(`/v1/apps/${appId}/analyticsReportRequests`, { limit: "200" });
  const live = ((listing.data ?? []) as Item[]).filter(
    (item) => item.attributes?.accessType === "ONGOING" && !item.attributes?.stoppedDueToInactivity,
  );
  const match = live.find((item) => item.id === known) ?? live[0];
  if (match) return { id: match.id, created: false };
  try {
    const created = await client.post("/v1/analyticsReportRequests", {
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: (created.data as Item).id, created: true };
  } catch (error) {
    if (error instanceof AscError && error.status === 403) {
      throw new AscError(403, "Apple would not start the downloads report for this key. The first request needs a key with the Admin role; after that any key with access to the app works.");
    }
    throw error;
  }
}

export type DownloadsRun = { started: boolean; processed: number; days: number; latest: string | null };

export async function collectDownloads(client: AscClient, files: AppFiles, appId: string): Promise<DownloadsRun> {
  const state = files.readReportState();
  const request = await ongoingRequest(client, appId, state.requestId);
  if (request.id !== state.requestId) state.requestId = request.id;

  const reports: Item[] = [];
  for await (const page of client.pages(`/v1/analyticsReportRequests/${request.id}/reports`, { limit: "200" })) {
    reports.push(...((page.data ?? []) as Item[]).filter((item) => String(item.attributes?.name ?? "").trim().toLowerCase() === REPORT_NAME));
  }

  const processed = new Set(state.processed);
  const pending: { id: string; date: string }[] = [];
  for (const report of reports) {
    for await (const page of client.pages(`/v1/analyticsReports/${report.id}/instances`, { "filter[granularity]": "DAILY", limit: "200" })) {
      for (const item of (page.data ?? []) as Item[]) {
        if (!processed.has(item.id)) pending.push({ id: item.id, date: String(item.attributes?.processingDate ?? "") });
      }
    }
  }
  pending.sort((a, b) => a.date.localeCompare(b.date));

  let rows = files.readDownloads();
  const touched = new Set<string>();
  for (const instance of pending) {
    const incoming: DownloadRow[] = [];
    for await (const page of client.pages(`/v1/analyticsReportInstances/${instance.id}/segments`, { limit: "200" })) {
      for (const segment of (page.data ?? []) as Item[]) {
        const link = segment.attributes?.url;
        if (typeof link === "string") incoming.push(...aggregateDownloads(await client.download(link), appId));
      }
    }
    const combined = new Map<string, DownloadRow>();
    for (const row of incoming) {
      const key = `${row.day}|${row.country}`;
      const sum = combined.get(key) ?? { ...row, firstTime: 0, redownloads: 0, institutional: 0 };
      sum.firstTime += row.firstTime;
      sum.redownloads += row.redownloads;
      sum.institutional += row.institutional;
      combined.set(key, sum);
    }
    rows = mergeDownloads(rows, [...combined.values()]);
    for (const row of combined.values()) touched.add(row.day);
    processed.add(instance.id);
  }

  state.processed = [...processed];
  files.writeDownloads(rows);
  files.writeReportState(state);
  const latest = rows.reduce<string | null>((most, row) => (!most || row.day > most ? row.day : most), null);
  return { started: request.created, processed: pending.length, days: touched.size, latest };
}
