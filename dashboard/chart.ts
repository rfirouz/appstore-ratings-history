import uPlot from "./vendor/uPlot.esm.js";
import { periodEnd, periodLabel, shortDate, type Bucket } from "./format.ts";

export type ChartSeries = {
  label: string;
  values: (number | null)[];
  /** A CSS custom property such as "--accent", or any canvas colour. */
  color: string;
  kind?: "line" | "bars" | "points";
  /** Share of the period slot a bar fills. */
  barSize?: number;
  opacity?: number;
  /** Draw a dot on every value of a line. */
  points?: boolean;
  format?: (value: number) => string;
};

export type ChartMarker = { date: string; label: string; detail?: string };

export type ChartOptions = {
  dates: string[];
  series: ChartSeries[];
  bucket: Bucket;
  markers?: ChartMarker[];
  /** Days to shade, for example days without a snapshot. */
  shaded?: string[];
  yRange?: [number, number];
  ySplits?: number[];
  /** Start the y axis at zero (the default) or fit it to the data. */
  zero?: boolean;
  integer?: boolean;
  formatY?: (value: number) => string;
  details?: (index: number) => string[];
  empty?: string;
  syncKey?: string;
  height?: number;
};

const DAY = 86_400;
/** Whole days and up; the values match uPlot's own time steps so its date labels still apply. */
const DAY_INCRS = [1, 2, 3, 7, 15, 30, 60, 90, 180, 365, 730, 1825].map((days) => days * DAY);
const INTEGER_INCRS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000, 2_000, 2_500, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

const toSeconds = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

function resolveColor(color: string): string {
  if (!color.startsWith("--")) return color;
  return getComputedStyle(document.documentElement).getPropertyValue(color).trim() || "#888888";
}

function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex?.[1]) return color;
  const n = parseInt(hex[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const defaultFormat = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
/** Same width on every chart, so plot areas line up above each other. */
const MIN_AXIS_WIDTH = 52;

/** Draws a time chart into `host` and returns a function that removes it. */
export function renderChart(host: HTMLElement, options: ChartOptions): () => void {
  const { dates, bucket, markers = [], shaded = [], yRange, ySplits, integer, formatY, details, syncKey } = options;
  const height = options.height ?? 220;
  const zero = options.zero ?? true;
  const visible = options.series.filter((item) => item.values.some((value) => value != null));
  host.replaceChildren();

  if (dates.length === 0 || visible.length === 0) {
    const empty = el("div", "plot-empty", options.empty ?? "No data in this range.");
    empty.style.height = `${Math.min(height, 150)}px`;
    host.append(empty);
    return () => host.replaceChildren();
  }

  const wrap = el("div", "plot-wrap");
  const node = el("div", "plot");
  const tip = el("div", "tip");
  wrap.append(node, tip);
  host.append(wrap);

  const endDays = dates.map((day) => periodEnd(day, bucket));
  const starts = dates.map(toSeconds);
  const ends = endDays.map(toSeconds);
  const xs = starts.map((start, index) => (start + ends[index]!) / 2);
  const pad = dates.length === 1 ? 3 * DAY : 0;
  const fullRange: [number, number] = [starts[0]! - pad, ends.at(-1)! + pad];
  const markerX = (day: string) => toSeconds(day) + DAY / 2;

  const muted = resolveColor("--muted");
  const line = resolveColor("--line");
  const ink = resolveColor("--ink");
  const paper = resolveColor("--paper");
  const colors = visible.map((item) => resolveColor(item.color));
  const fontFamily = getComputedStyle(document.body).fontFamily;
  const axisFont = `11px ${fontFamily}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (measure) measure.font = axisFont;

  const formatTick = (value: number) => (formatY ? formatY(value) : defaultFormat(value));
  const niceTop = (max: number | null) => {
    if (max == null || !Number.isFinite(max) || max <= 0) return integer ? 4 : 1;
    return uPlot.rangeNum(0, max, 0.1, true)[1];
  };
  const bars = uPlot.paths.bars;

  const seriesOpts: uPlot.Series[] = visible.map((item, index) => {
    const color = colors[index]!;
    const kind = item.kind ?? "line";
    if (kind === "bars") {
      return {
        label: item.label,
        stroke: color,
        fill: withAlpha(color, item.opacity ?? 0.6),
        width: 0,
        paths: bars ? bars({ size: [item.barSize ?? 0.72, 56, 1], align: 0 }) : undefined,
        points: { show: false },
      };
    }
    if (kind === "points") {
      return {
        label: item.label,
        stroke: color,
        paths: () => null,
        points: { show: true, size: 7, width: 1.5, stroke: color, fill: withAlpha(color, 0.45) },
      };
    }
    const isolated = item.values.flatMap((value, i) => (value != null && item.values[i - 1] == null && item.values[i + 1] == null ? [i] : []));
    return {
      label: item.label,
      stroke: color,
      width: 1.75,
      spanGaps: false,
      points: item.points
        ? { show: true, size: 6, width: 1.5, stroke: color, fill: paper }
        : { show: false, filter: isolated.length ? isolated : null, size: 6, width: 1.5, stroke: color, fill: color },
    };
  });

  let hovered = false;

  const renderTip = (plot: uPlot, index: number) => {
    tip.replaceChildren(el("div", "tip-head", periodLabel(dates[index]!, bucket)));
    visible.forEach((item, seriesIndex) => {
      if (!plot.series[seriesIndex + 1]?.show) return;
      const value = item.values[index];
      const row = el("div", "tip-row");
      const swatch = el("i", "");
      swatch.style.background = colors[seriesIndex]!;
      const format = item.format ?? formatTick;
      row.append(swatch, el("span", "", item.label), el("strong", "", value == null ? "–" : format(value)));
      tip.append(row);
    });
    for (const note of details?.(index) ?? []) tip.append(el("div", "tip-note", note));
    for (const marker of markers) {
      if (marker.date < dates[index]! || marker.date >= endDays[index]!) continue;
      tip.append(el("div", "tip-marker", `Version ${marker.label}${bucket === "day" ? "" : ` · ${shortDate(marker.date)}`}`));
      if (marker.detail) tip.append(el("div", "tip-note", marker.detail.length > 160 ? `${marker.detail.slice(0, 160)}…` : marker.detail));
    }
  };

  const placeTip = (plot: uPlot, left: number) => {
    const bounds = wrap.getBoundingClientRect();
    const over = plot.over.getBoundingClientRect();
    const x = over.left - bounds.left + left;
    const width = tip.offsetWidth;
    let tx = x + 14;
    if (tx + width > bounds.width) tx = x - 14 - width;
    tip.style.transform = `translate(${Math.max(0, tx)}px, ${over.top - bounds.top + 4}px)`;
  };

  const yScale: uPlot.Scale = yRange
    ? { range: () => yRange }
    : zero
      ? { range: (_plot, _min, max) => [0, niceTop(max)] }
      : { range: (_plot, min, max) => uPlot.rangeNum(min ?? 0, max ?? 1, 0.1, true) };

  const opts: uPlot.Options = {
    width: node.clientWidth || 600,
    height,
    padding: [markers.length ? 20 : 10, 14, 0, 0],
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), "Etc/UTC"),
    legend: { show: visible.length > 1, live: false },
    cursor: {
      y: false,
      drag: { x: true, y: false, setScale: true },
      points: { size: 7, width: 2, fill: paper },
      ...(syncKey ? { sync: { key: syncKey } } : {}),
    },
    scales: {
      x: {
        time: true,
        range: (_plot, min, max) => {
          // uPlot widens a single point by 1000 days in seconds mode, so a lone date always gets the padded range.
          if (min == null || max == null || xs.length === 1 || (min === xs[0] && max === xs.at(-1))) return fullRange;
          return [min, max];
        },
      },
      y: yScale,
    },
    axes: [
      { stroke: muted, font: axisFont, incrs: DAY_INCRS, grid: { show: false }, ticks: { stroke: line, width: 1, size: 4 } },
      {
        stroke: muted,
        font: axisFont,
        gap: 6,
        grid: { stroke: line, width: 1 },
        ticks: { show: false },
        size: (_plot, values) => {
          if (!values || !measure) return MIN_AXIS_WIDTH;
          return Math.max(MIN_AXIS_WIDTH, Math.ceil(Math.max(0, ...values.map((value) => measure.measureText(String(value ?? "")).width))) + 16);
        },
        ...(integer ? { incrs: INTEGER_INCRS } : {}),
        ...(ySplits ? { splits: () => ySplits } : {}),
        values: (_plot, splits) => splits.map((value) => (value == null ? "" : formatTick(value))),
      },
    ],
    series: [{}, ...seriesOpts],
    hooks: {
      drawClear: [
        (plot) => {
          if (!shaded.length) return;
          const { ctx, bbox } = plot;
          const x = (seconds: number) => plot.valToPos(seconds, "x", true);
          const shadedSet = new Set(shaded);
          ctx.save();
          ctx.beginPath();
          ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
          ctx.clip();
          ctx.fillStyle = withAlpha(muted, 0.16);
          dates.forEach((day, index) => {
            if (!shadedSet.has(day)) return;
            const x0 = x(starts[index]!);
            ctx.fillRect(x0, bbox.top, Math.max(x(ends[index]!) - x0, 1), bbox.height);
          });
          ctx.restore();
        },
      ],
      draw: [
        (plot) => {
          if (!markers.length) return;
          const { ctx, bbox } = plot;
          const ratio = uPlot.pxRatio;
          const right = bbox.left + bbox.width;
          let labelEnd = -Infinity;
          const shown = markers.filter((marker) => {
            const x = plot.valToPos(markerX(marker.date), "x", true);
            return x >= bbox.left && x <= right;
          }).length;
          const lineAlpha = shown > 30 ? 0.25 : shown > 12 ? 0.4 : 0.7;
          ctx.save();
          ctx.font = `${10 * ratio}px ${fontFamily}`;
          ctx.textBaseline = "bottom";
          ctx.lineWidth = ratio;
          for (const marker of [...markers].sort((a, b) => a.date.localeCompare(b.date))) {
            const x = Math.round(plot.valToPos(markerX(marker.date), "x", true));
            if (x < bbox.left || x > right) continue;
            ctx.strokeStyle = withAlpha(ink, lineAlpha);
            ctx.setLineDash([3 * ratio, 3 * ratio]);
            ctx.beginPath();
            ctx.moveTo(x, bbox.top);
            ctx.lineTo(x, bbox.top + bbox.height);
            ctx.stroke();
            const width = ctx.measureText(marker.label).width;
            const textX = Math.min(x + 3 * ratio, right - width);
            if (textX > labelEnd + 6 * ratio) {
              ctx.fillStyle = muted;
              ctx.fillText(marker.label, textX, bbox.top - 3 * ratio);
              labelEnd = textX + width;
            }
          }
          ctx.restore();
        },
      ],
      setCursor: [
        (plot) => {
          const index = plot.cursor.idx;
          const left = plot.cursor.left ?? -1;
          if (!hovered || index == null || left < 0) {
            tip.style.display = "none";
            return;
          }
          renderTip(plot, index);
          tip.style.display = "block";
          placeTip(plot, left);
        },
      ],
    },
  };

  const plot = new uPlot(opts, [xs, ...visible.map((item) => item.values)] as uPlot.AlignedData, node);
  const enter = () => {
    hovered = true;
  };
  const leave = () => {
    hovered = false;
    tip.style.display = "none";
  };
  plot.over.addEventListener("mouseenter", enter);
  plot.over.addEventListener("mouseleave", leave);
  const observer = new ResizeObserver(() => {
    if (node.clientWidth && node.clientWidth !== plot.width) plot.setSize({ width: node.clientWidth, height });
  });
  observer.observe(node);
  return () => {
    observer.disconnect();
    plot.over.removeEventListener("mouseenter", enter);
    plot.over.removeEventListener("mouseleave", leave);
    plot.destroy();
    host.replaceChildren();
  };
}
