import type { AppPayload, AppSummary, CountrySummary, DayPoint, ReviewRow } from "../src/types.ts";
import { renderChart, type ChartMarker, type ChartOptions } from "./chart.ts";
import {
  daysBetween,
  formatInt,
  formatNumber,
  formatPct,
  formatStars,
  periodEnd,
  periodLabel,
  periodStart,
  plural,
  shiftDays,
  shortDate,
  signed,
  type Bucket,
} from "./format.ts";

type Range = "30" | "90" | "365" | "all";
type State = { app: string; range: Range; bucket: Bucket; country: string };

type Row = {
  day: string;
  end: string;
  length: number;
  partial: boolean;
  newRatings: number | null;
  newAverage: number | null;
  sample: number;
  ratings: number | null;
  average: number | null;
  missing: number;
  missedShare: number;
  estimated: string[];
  resets: string[];
  removed: number;
  failed: string[];
  downloads: number | null;
  institutional: number;
  conversion: number | null;
  reviews: number;
  reviewStars: number;
};

const RANGES: { id: Range; label: string }[] = [
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "365", label: "1 year" },
  { id: "all", label: "All" },
];
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];
const UPDATE_WINDOW = 7;

const root = document.getElementById("app")!;
let cleanups: (() => void)[] = [];
let apps: AppSummary[] = [];
let payload: AppPayload | null = null;
let payloadKey = "";
let sequence = 0;
let state = readHash();

function readHash(): State {
  const params = new URLSearchParams(location.hash.slice(1));
  const range = params.get("range") as Range | null;
  const bucket = params.get("group") as Bucket | null;
  return {
    app: params.get("app") ?? "",
    range: range && RANGES.some((item) => item.id === range) ? range : "90",
    bucket: bucket && BUCKETS.some((item) => item.id === bucket) ? bucket : "day",
    country: params.get("country") ?? "",
  };
}

function writeHash(): void {
  const params = new URLSearchParams({ app: state.app, range: state.range, group: state.bucket });
  if (state.country) params.set("country", state.country);
  history.replaceState(null, "", `#${params}`);
}

function update(change: Partial<State>): void {
  state = { ...state, ...change };
  writeHash();
  void refresh();
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

type Child = Node | string | null | undefined | false;

function h(tag: string, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value as EventListener);
    else if (name === "class") node.className = String(value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

// Theme

function applyTheme(theme: string | null): void {
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
  if (payload) render(payload, lastExtras.countries, lastExtras.reviews);
}

// Data shaping

function rollup(days: DayPoint[], bucket: Bucket, from: string, lastDay: string): Row[] {
  const groups = new Map<string, DayPoint[]>();
  for (const day of days) {
    const key = periodStart(day.day, bucket);
    const list = groups.get(key) ?? [];
    list.push(day);
    groups.set(key, list);
  }
  const rows = [...groups].map(([start, list]): Row => {
    const end = periodEnd(start, bucket);
    const known = list.filter((day) => day.newRatings != null);
    const withAverage = list.filter((day) => day.newAverage != null && day.newAverageSample > 0);
    const sample = withAverage.reduce((sum, day) => sum + day.newAverageSample, 0);
    const last = [...list].reverse().find((day) => day.ratings != null);
    const downloadDays = list.filter((day) => day.downloads != null);
    const paired = list.filter((day) => day.newRatings != null && day.downloads != null);
    const pairedDownloads = paired.reduce((sum, day) => sum + (day.downloads ?? 0), 0);
    return {
      day: start,
      end,
      length: list.length,
      partial: bucket !== "day" && (start < from || end > shiftDays(lastDay, 1)),
      newRatings: known.length ? known.reduce((sum, day) => sum + (day.newRatings ?? 0), 0) : null,
      newAverage: sample ? withAverage.reduce((sum, day) => sum + (day.newAverage ?? 0) * day.newAverageSample, 0) / sample : null,
      sample,
      ratings: last?.ratings ?? null,
      average: last?.average ?? null,
      missing: list.filter((day) => !day.snapshot).length,
      missedShare: list.filter((day) => day.snapshot && day.missedShare).length,
      estimated: [...new Set(list.flatMap((day) => day.estimated))],
      resets: [...new Set(list.flatMap((day) => day.resets))],
      removed: list.reduce((sum, day) => sum + day.removed, 0),
      failed: [...new Set(list.flatMap((day) => day.failed))],
      downloads: downloadDays.length ? downloadDays.reduce((sum, day) => sum + (day.downloads ?? 0), 0) : null,
      institutional: list.reduce((sum, day) => sum + (day.institutional ?? 0), 0),
      conversion: pairedDownloads ? paired.reduce((sum, day) => sum + (day.newRatings ?? 0), 0) / pairedDownloads : null,
      reviews: list.reduce((sum, day) => sum + day.reviews, 0),
      reviewStars: list.reduce((sum, day) => sum + day.reviewStars, 0),
    };
  });
  if (bucket === "day") {
    rows.forEach((row, index) => {
      const window = days.slice(Math.max(0, index - 6), index + 1).filter((day) => day.newRatings != null && day.downloads != null);
      const downloads = window.reduce((sum, day) => sum + (day.downloads ?? 0), 0);
      row.conversion = downloads ? window.reduce((sum, day) => sum + (day.newRatings ?? 0), 0) / downloads : null;
    });
  }
  return rows;
}

type Totals = {
  newRatings: number;
  coveredDays: number;
  average: number | null;
  sample: number;
  conversion: number | null;
  missed: number;
  estimated: string[];
};

function totals(days: DayPoint[]): Totals {
  const known = days.filter((day) => day.newRatings != null);
  const withAverage = days.filter((day) => day.newAverage != null && day.newAverageSample > 0);
  const sample = withAverage.reduce((sum, day) => sum + day.newAverageSample, 0);
  const paired = days.filter((day) => day.newRatings != null && day.downloads != null);
  const pairedDownloads = paired.reduce((sum, day) => sum + (day.downloads ?? 0), 0);
  return {
    newRatings: known.reduce((sum, day) => sum + (day.newRatings ?? 0), 0),
    coveredDays: known.length,
    average: sample ? withAverage.reduce((sum, day) => sum + (day.newAverage ?? 0) * day.newAverageSample, 0) / sample : null,
    sample,
    conversion: pairedDownloads ? paired.reduce((sum, day) => sum + (day.newRatings ?? 0), 0) / pairedDownloads : null,
    missed: known.filter((day) => !day.snapshot).length,
    estimated: [...new Set(known.flatMap((day) => day.estimated))],
  };
}

const countryCodes = (codes: string[], limit = 4): string =>
  codes.length > limit
    ? `${codes.slice(0, limit).map((code) => code.toUpperCase()).join(", ")} and ${codes.length - limit} more`
    : codes.map((code) => code.toUpperCase()).join(", ");

function estimateNote(windows: Totals[]): string | null {
  const missed = windows.reduce((sum, window) => sum + window.missed, 0);
  const estimated = [...new Set(windows.flatMap((window) => window.estimated))];
  const reasons = [
    missed ? plural(missed, "missed snapshot") : null,
    estimated.length ? `failed checks in ${countryCodes(estimated)}` : null,
  ].filter(Boolean);
  return reasons.length ? `Includes estimates for ${reasons.join(" and ")}` : null;
}

function markersFor(data: AppPayload): ChartMarker[] {
  return data.versions
    .map((version) => ({ date: version.released || version.firstSeen, label: version.version, detail: version.notes }))
    .filter((marker) => marker.date);
}

// Rendering

let lastExtras: { countries: CountrySummary[]; reviews: ReviewRow[] } = { countries: [], reviews: [] };

async function refresh(): Promise<void> {
  const run = ++sequence;
  root.classList.add("loading");
  try {
    const key = `${state.app}|${state.country}`;
    if (key !== payloadKey || !payload) {
      const next = await getJson<AppPayload>(`/api/apps/${state.app}?country=${encodeURIComponent(state.country)}`);
      if (run !== sequence) return;
      payload = next;
      payloadKey = key;
    }
    const data = payload;
    const { from, to } = rangeOf(data);
    const query = `from=${from}&to=${to}`;
    const [countries, reviews] = await Promise.all([
      getJson<CountrySummary[]>(`/api/apps/${state.app}/countries?${query}`),
      data.hasReviews
        ? getJson<ReviewRow[]>(`/api/apps/${state.app}/reviews?${query}&country=${encodeURIComponent(state.country)}&limit=30`)
        : Promise.resolve([]),
    ]);
    if (run !== sequence) return;
    lastExtras = { countries, reviews };
    render(data, countries, reviews);
  } catch (error) {
    if (run === sequence) showError(error as Error);
  } finally {
    if (run === sequence) root.classList.remove("loading");
  }
}

function rangeOf(data: AppPayload): { from: string; to: string } {
  const first = data.days[0]?.day ?? "";
  const to = data.days.at(-1)?.day ?? "";
  if (state.range === "all" || !first) return { from: first, to };
  const from = shiftDays(to, -(Number(state.range) - 1));
  return { from: from < first ? first : from, to };
}

function showError(error: Error): void {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  root.replaceChildren(h("div", { class: "banner" }, `Couldn't load the dashboard data: ${error.message}`));
}

function segmented<T extends string>(items: { id: T; label: string }[], current: T, pick: (id: T) => void): HTMLElement {
  return h(
    "div",
    { class: "seg" },
    ...items.map((item) => h("button", { class: item.id === current ? "on" : "", onclick: () => pick(item.id) }, item.label)),
  );
}

function kpi(label: string, value: string, note: string, tone = ""): HTMLElement {
  return h("div", { class: "card kpi" }, h("div", { class: "kpi-label" }, label), h("div", { class: "kpi-value" }, value), h("div", { class: `kpi-note ${tone}` }, note));
}

function chartCard(title: string, description: string, options: ChartOptions, charts: [HTMLElement, ChartOptions][]): HTMLElement {
  const host = h("div");
  charts.push([host, options]);
  return h("section", { class: "card" }, h("div", { class: "chart-head" }, h("div", {}, h("h2", {}, title), h("p", { class: "chart-note" }, description))), host);
}

function header(data: AppPayload): HTMLElement {
  const app = data.app;
  const lastRun = data.lastRun;
  const age = lastRun ? daysBetween(lastRun.day, new Date().toISOString().slice(0, 10)) : null;
  const picker =
    apps.length > 1
      ? h(
          "select",
          { onchange: (event: Event) => update({ app: (event.target as HTMLSelectElement).value, country: "" }) },
          ...apps.map((item) => h("option", { value: item.app.id, selected: item.app.id === app.id }, item.app.name)),
        )
      : null;
  return h(
    "header",
    { class: "top" },
    h(
      "div",
      { class: "brand" },
      app.icon ? h("img", { class: "icon", src: app.icon, alt: "" }) : null,
      h(
        "div",
        {},
        h("h1", {}, app.name),
        h(
          "p",
          { class: "sub" },
          [app.seller, lastRun ? `last snapshot ${shortDate(lastRun.day)} in ${plural(lastRun.listed, "country", "countries")}` : "no snapshots yet"]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    ),
    h("div", { class: "top-actions" }, picker, h("button", { class: "icon-btn", onclick: toggleTheme, title: "Switch light or dark" }, "◐")),
    age != null && age > 2
      ? h("div", { class: "banner warn wide" }, `The latest snapshot is ${age} days old. Check the "Snapshot ratings" workflow in your GitHub repository's Actions tab.`)
      : null,
  );
}

function render(data: AppPayload, countries: CountrySummary[], reviews: ReviewRow[]): void {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];

  const { from, to } = rangeOf(data);
  const days = data.days.filter((day) => day.day >= from && day.day <= to);
  const rows = rollup(days, state.bucket, from, to);
  const dates = rows.map((row) => row.day);
  const markers = markersFor(data);
  const bucket = state.bucket;
  const period = bucket === "day" ? "day" : bucket === "week" ? "week" : "month";
  const baselineOnly = !data.days.some((day) => day.newRatings != null);
  const firstDay = data.days[0]?.day ?? to;
  const countryLabel = state.country ? (data.countries.find((item) => item.code === state.country)?.name ?? state.country.toUpperCase()) : "all countries";

  const sum = totals(days);
  const lastWithTotal = [...days].reverse().find((day) => day.ratings != null);
  const firstWithTotal = days.find((day) => day.ratings != null);
  const rawChange = lastWithTotal?.average != null && firstWithTotal?.average != null && lastWithTotal !== firstWithTotal ? lastWithTotal.average - firstWithTotal.average : null;
  const averageChange = rawChange != null && Math.abs(rawChange) < 0.0005 ? 0 : rawChange;
  const perDay = sum.coveredDays ? sum.newRatings / sum.coveredDays : null;

  const kpis = h(
    "div",
    { class: "kpis" },
    kpi("New ratings", baselineOnly ? "–" : formatInt(sum.newRatings), baselineOnly ? "after the second snapshot" : `${formatNumber(perDay)} per day`),
    kpi("Average of new ratings", formatStars(sum.average), sum.sample ? `from ${plural(sum.sample, "rating")}` : "not enough new ratings yet"),
    kpi(
      "Store average",
      formatStars(lastWithTotal?.average),
      averageChange == null
        ? countryLabel
        : averageChange === 0
          ? `unchanged since ${shortDate(firstWithTotal!.day)}`
          : `${signed(averageChange, (value) => value.toFixed(3))} since ${shortDate(firstWithTotal!.day)}`,
      averageChange == null || averageChange === 0 ? "" : averageChange > 0 ? "up" : "down",
    ),
    kpi("Total ratings", formatInt(lastWithTotal?.ratings), state.country ? countryLabel : `in ${plural(data.countries.length, "country", "countries")}`),
    data.hasDownloads ? kpi("Download → rating", formatPct(sum.conversion), "new ratings ÷ first-time downloads") : null,
  );

  const filters = h(
    "div",
    { class: "filters" },
    segmented(RANGES, state.range, (range) => update({ range })),
    segmented(BUCKETS, state.bucket, (bucket) => update({ bucket })),
    h(
      "select",
      { onchange: (event: Event) => update({ country: (event.target as HTMLSelectElement).value }) },
      h("option", { value: "" }, "All countries"),
      ...data.countries.map((item) => h("option", { value: item.code, selected: item.code === state.country }, `${item.name} (${formatInt(item.ratings)})`)),
    ),
  );

  const notesFor = (index: number): string[] => {
    const row = rows[index];
    if (!row) return [];
    const notes: string[] = [];
    if (row.partial) notes.push(`Only ${plural(row.length, "day")} of this ${period} are in view.`);
    if (bucket !== "day" && row.newRatings != null && row.length > 1) notes.push(`${formatNumber(row.newRatings / row.length)} new ratings per day`);
    if (bucket === "day" && row.missing) {
      notes.push(
        row.newRatings == null
          ? "No snapshot for this day. The next snapshot will fill it in."
          : "No snapshot for this day. Its new ratings are an estimate: the next snapshot's ratings are spread evenly across the gap.",
      );
    }
    if (bucket !== "day" && row.missing) notes.push(`No snapshot on ${plural(row.missing, "day")}; their new ratings are estimated.`);
    if (row.missedShare) {
      notes.push(
        bucket === "day"
          ? "Part of these ratings is an estimate: the ratings since the last snapshot are spread evenly across the missed days."
          : `${plural(row.missedShare, "day")} share ratings with missed snapshots.`,
      );
    }
    if (row.estimated.length) notes.push(`Estimated for ${countryCodes(row.estimated)}: ratings after a failed check are spread evenly across the days it missed.`);
    if (row.resets.length) notes.push(`Rating summary reset in ${countryCodes(row.resets, Infinity)}; counted the ratings since the reset.`);
    if (row.removed) notes.push(`${plural(row.removed, "rating")} disappeared (usually removed by Apple).`);
    if (row.failed.length) {
      const pending = row.failed.some((code) => !row.estimated.includes(code));
      notes.push(`Couldn't check: ${countryCodes(row.failed, Infinity)}.${pending ? " Filled in after the next successful check." : ""}`);
    }
    return notes;
  };

  const shaded = rows.filter((row) => row.missing === row.length).map((row) => row.day);
  const charts: [HTMLElement, ChartOptions][] = [];
  const base = { dates, bucket, markers, shaded, syncKey: "main", details: notesFor };
  const baselineText = `Your first snapshot (${shortDate(firstDay)}) is the starting point. New ratings show up after the next daily snapshot.`;

  const sections: HTMLElement[] = [
    chartCard(
      "New ratings",
      data.hasReviews ? `Star ratings added each ${period}, and how many came with a written review.` : `Star ratings added each ${period}, from the daily change in Apple's rating count.`,
      {
        ...base,
        integer: true,
        empty: baselineOnly ? baselineText : undefined,
        series: [
          { label: "New ratings", values: rows.map((row) => row.newRatings), color: "--accent", kind: "bars", barSize: 0.82, opacity: 0.4, format: formatInt },
          ...(data.hasReviews
            ? [{ label: "Written reviews", values: rows.map((row) => (baselineOnly ? null : row.reviews)), color: "--series-2", kind: "bars" as const, barSize: 0.44, opacity: 0.9, format: formatInt }]
            : []),
        ],
      },
      charts,
    ),
    chartCard(
      "Average rating",
      `The store average, and the average stars of the ratings added each ${period}.`,
      {
        ...base,
        yRange: [0.75, 5.25],
        ySplits: [1, 2, 3, 4, 5],
        formatY: (value) => value.toFixed(0),
        details: (index) => {
          const row = rows[index];
          const notes = notesFor(index);
          if (row?.sample) notes.unshift(`New ratings' average is based on ${plural(row.sample, "rating")}${row.sample < 10 ? ", so it moves a lot" : ""}.`);
          return notes;
        },
        series: [
          { label: "Store average", values: rows.map((row) => row.average), color: "--accent", format: formatStars },
          { label: `New ratings that ${period}`, values: rows.map((row) => row.newAverage), color: "--series-2", kind: bucket === "day" ? "points" : "line", points: true, format: formatStars },
        ],
      },
      charts,
    ),
    chartCard(
      "Total ratings",
      "Apple's rating count at the end of each period.",
      { ...base, zero: false, integer: true, series: [{ label: "Total ratings", values: rows.map((row) => row.ratings), color: "--ink", format: formatInt }] },
      charts,
    ),
  ];

  if (data.hasDownloads) {
    sections.push(
      chartCard(
        "First-time downloads",
        "From App Store Connect. School and volume purchases are left out; Apple's report arrives one to two days late.",
        {
          ...base,
          integer: true,
          details: (index) => {
            const row = rows[index];
            const notes = notesFor(index);
            if (row?.institutional) notes.push(`+${plural(row.institutional, "school licence")}, not counted.`);
            return notes;
          },
          series: [{ label: "First-time downloads", values: rows.map((row) => row.downloads), color: "--accent", kind: "bars", format: formatInt }],
        },
        charts,
      ),
      chartCard(
        "Download → rating",
        bucket === "day"
          ? "New ratings ÷ first-time downloads over the last 7 days."
          : `New ratings ÷ first-time downloads each ${period}.`,
        {
          ...base,
          formatY: (value) => formatPct(value, 1),
          series: [{ label: bucket === "day" ? "7-day conversion" : `Conversion per ${period}`, values: rows.map((row) => row.conversion), color: "--accent", format: (value) => formatPct(value, 2) }],
        },
        charts,
      ),
    );
  }

  sections.push(updatesCard(data, markers));
  sections.push(countriesCard(countries, from, to));
  if (data.hasReviews) sections.push(reviewsCard(reviews));

  root.replaceChildren(
    header(data),
    filters,
    h("p", { class: "range-note" }, `${shortDate(from)} – ${shortDate(to)} · ${countryLabel}`),
    kpis,
    ...sections,
    footer(),
  );
  for (const [host, options] of charts) cleanups.push(renderChart(host, options));
}

function updatesCard(data: AppPayload, markers: ChartMarker[]): HTMLElement {
  const first = data.days[0]?.day ?? "";
  const last = data.days.at(-1)?.day ?? "";
  const windowStats = (start: string, end: string) => totals(data.days.filter((day) => day.day >= start && day.day <= end));
  const rows = [...markers]
    .filter((marker) => marker.date > first && marker.date <= last)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)
    .map((marker) => {
      const before = windowStats(shiftDays(marker.date, -UPDATE_WINDOW), shiftDays(marker.date, -1));
      const after = windowStats(marker.date, shiftDays(marker.date, UPDATE_WINDOW - 1));
      const rate = (value: Totals) => (value.coveredDays ? value.newRatings / value.coveredDays : null);
      const collecting = after.coveredDays < UPDATE_WINDOW;
      const estimate = estimateNote([before, after]);
      return h(
        "tr",
        {},
        h(
          "td",
          {},
          h("strong", {}, marker.label),
          h("div", { class: "muted small" }, shortDate(marker.date)),
          estimate ? h("div", { class: "muted small" }, estimate) : null,
        ),
        h("td", { class: "num" }, formatNumber(rate(before))),
        h("td", { class: "num" }, formatNumber(rate(after)), collecting ? h("div", { class: "muted small" }, `${after.coveredDays} of ${UPDATE_WINDOW} days so far`) : null),
        h("td", { class: "num" }, formatStars(before.average)),
        h("td", { class: "num" }, formatStars(after.average)),
      );
    });
  return h(
    "section",
    { class: "card" },
    h("div", { class: "chart-head" }, h("div", {}, h("h2", {}, "Updates"), h("p", { class: "chart-note" }, `New ratings per day and their average in the ${UPDATE_WINDOW} days before and after each version went live.`))),
    rows.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", {}, "Version"), h("th", { class: "num" }, "Per day before"), h("th", { class: "num" }, "Per day after"), h("th", { class: "num" }, "Average before"), h("th", { class: "num" }, "Average after"))),
            h("tbody", {}, ...rows),
          ),
        )
      : h("div", { class: "plot-empty small-empty" }, "Updates released after your first snapshot will be compared here."),
  );
}

function countriesCard(countries: CountrySummary[], from: string, to: string): HTMLElement {
  let expanded = false;
  const body = h("tbody");
  const more = h("button", { class: "ghost" });
  const fill = () => {
    const shown = expanded ? countries : countries.slice(0, 12);
    body.replaceChildren(
      ...shown.map((item) =>
        h(
          "tr",
          { class: `clickable${item.code === state.country ? " selected" : ""}`, onclick: () => update({ country: item.code === state.country ? "" : item.code }) },
          h("td", {}, item.name),
          h("td", { class: "num" }, formatInt(item.ratings)),
          h("td", { class: "num" }, formatStars(item.average)),
          h("td", { class: "num" }, item.newRatings ? formatInt(item.newRatings) : "–"),
          h("td", { class: "num" }, formatStars(item.newAverage)),
        ),
      ),
    );
    more.textContent = expanded ? "Show fewer" : `Show all ${countries.length}`;
    more.hidden = countries.length <= 12;
  };
  more.addEventListener("click", () => {
    expanded = !expanded;
    fill();
  });
  fill();
  return h(
    "section",
    { class: "card" },
    h("div", { class: "chart-head" }, h("div", {}, h("h2", {}, "Countries"), h("p", { class: "chart-note" }, `New ratings from ${shortDate(from)} to ${shortDate(to)}. Click a country to filter the charts.`))),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Country"), h("th", { class: "num" }, "Total ratings"), h("th", { class: "num" }, "Average"), h("th", { class: "num" }, "New in range"), h("th", { class: "num" }, "Average of new"))),
        body,
      ),
    ),
    more,
  );
}

function reviewsCard(reviews: ReviewRow[]): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("div", { class: "chart-head" }, h("div", {}, h("h2", {}, "Latest written reviews"), h("p", { class: "chart-note" }, "From App Store Connect, newest first."))),
    reviews.length
      ? h(
          "div",
          {},
          ...reviews.map((review) =>
            h(
              "article",
              { class: "review" },
              h(
                "div",
                { class: "review-meta" },
                h("span", { class: "stars", title: `${review.rating} stars` }, "★".repeat(review.rating) + "☆".repeat(Math.max(0, 5 - review.rating))),
                h("span", {}, shortDate(review.created.slice(0, 10))),
                h("span", {}, review.country.toUpperCase()),
                review.nickname ? h("span", {}, review.nickname) : null,
              ),
              review.title ? h("strong", {}, review.title) : null,
              h("p", {}, review.body),
            ),
          ),
        )
      : h("div", { class: "plot-empty small-empty" }, "No written reviews in this range."),
  );
}

function footer(): HTMLElement {
  return h(
    "footer",
    { class: "footer" },
    h("p", {}, "New ratings are the day-to-day change in the rating count Apple shows in each country. Their average comes from the change in total stars, so days with only a few ratings are rough. When a snapshot is missed or a country can't be checked, the ratings that show up at the next check are spread evenly across the days in between. Grey stripes mark days without a snapshot, and tooltips say which numbers are estimates."),
    h("p", {}, "Hover a chart for details, drag across it to zoom, double-click to zoom out, and click a legend entry to hide it."),
  );
}

function renderEmpty(): void {
  root.replaceChildren(
    h(
      "section",
      { class: "card onboarding" },
      h("h1", {}, "No snapshots yet"),
      h("p", {}, "This dashboard reads the snapshots saved in the data folder. To get the first one:"),
      h(
        "ol",
        {},
        h("li", {}, "On GitHub, open your repository's Settings → Secrets and variables → Actions → Variables, and add APP_IDS with your App Store ID."),
        h("li", {}, 'Open the Actions tab, pick "Snapshot ratings" and click "Run workflow".'),
        h("li", {}, "When it finishes, run the dashboard again. It pulls the new data first."),
      ),
      h("p", { class: "muted" }, "Running it on this computer instead? Put APP_IDS=your-id in a .env file and run npm run collect."),
    ),
  );
}

async function start(): Promise<void> {
  applyTheme(localStorage.getItem("theme"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem("theme")) {
      applyTheme(null);
      if (payload) render(payload, lastExtras.countries, lastExtras.reviews);
    }
  });
  try {
    apps = await getJson<AppSummary[]>("/api/apps");
  } catch (error) {
    showError(error as Error);
    return;
  }
  if (!apps.length) {
    renderEmpty();
    return;
  }
  if (!apps.some((item) => item.app.id === state.app)) state = { ...state, app: apps[0]!.app.id, country: "" };
  writeHash();
  await refresh();
}

void start();
