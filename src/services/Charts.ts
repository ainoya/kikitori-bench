import type { BenchmarkReport, ModelUsageSummary } from "../schemas/judge.js";

/**
 * Renders the visual summary of a run: the price/performance and
 * speed/performance Pareto frontiers, and the per-axis breakdown.
 *
 * Each chart is emitted as a standalone SVG so it can be committed and embedded
 * in documentation, and as one interactive HTML page for local inspection.
 * Only aggregate values are drawn - model names, scores, costs - never a sample
 * id or any transcript text.
 */

/** Palette and marks, inlined so each SVG renders on its own. */
const SVG_STYLE = `
  .surface { fill: #fcfcfb; }
  .grid line { stroke: #e6e5e0; stroke-width: 1; }
  .axis text, .axis-title, .group-label { fill: #52514e; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; }
  .axis text { font-size: 11px; }
  .axis-title, .group-label { font-size: 12px; }
  .frontier { fill: none; stroke: #2a78d6; stroke-width: 2; stroke-dasharray: 5 4; opacity: .85; }
  .hit { fill: transparent; }
  .mark .dot { stroke: #2a78d6; stroke-width: 2; }
  .mark.on .dot { fill: #2a78d6; }
  .mark.off .dot { fill: #fcfcfb; }
  .point-label { fill: #0b0b0b; font-size: 12px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; }
  .bar rect { fill: #2a78d6; }
  .bar.s2 rect { fill: #eb6834; }
  .bar.s3 rect { fill: #1baf7a; }
  .bar.s4 rect { fill: #eda100; }
  .chart-title { fill: #0b0b0b; font-size: 15px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; }
  .chart-subtitle, .chart-footnote { fill: #78776f; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; }
  .legend-text { fill: #52514e; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; }
    .grid line { stroke: #333330; }
    .axis text, .axis-title, .group-label, .legend-text { fill: #c3c2b7; }
    .frontier, .mark .dot { stroke: #3987e5; }
    .mark.on .dot { fill: #3987e5; }
    .mark.off .dot { fill: #1a1a19; }
    .point-label, .chart-title { fill: #ffffff; }
    .chart-subtitle, .chart-footnote { fill: #96958c; }
    .bar rect { fill: #3987e5; }
    .bar.s2 rect { fill: #d95926; }
    .bar.s3 rect { fill: #199e70; }
    .bar.s4 rect { fill: #c98500; }
  }
`;

interface LegendItem {
  /** "dot" for the frontier scatter, "swatch" for the grouped bars. */
  shape: "dot-on" | "dot-off" | "swatch";
  label: string;
  className?: string;
}

/**
 * Draw the legend inside the SVG. In the HTML page it lives in the markup next
 * to the chart, but a standalone file has to carry its own key or the filled
 * versus hollow marks mean nothing.
 */
const withLegend = (svg: string, items: readonly LegendItem[]): string => {
  const match = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!match) return svg;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const y = height + 14;

  let x = 66;
  const parts: string[] = [];
  for (const item of items) {
    const mark =
      item.shape === "swatch"
        ? `<g class="bar ${item.className ?? ""}"><rect x="${x}" y="${y - 8}" width="11" height="11" rx="2"/></g>`
        : `<g class="mark ${item.shape === "dot-on" ? "on" : "off"}"><circle class="dot" cx="${x + 5}" cy="${y - 3}" r="5"/></g>`;
    parts.push(`${mark}<text class="legend-text" x="${x + 17}" y="${y + 1}">${item.label}</text>`);
    x += 17 + item.label.length * 6.6 + 22;
  }

  return svg
    .replace(`viewBox="0 0 ${match[1]} ${match[2]}"`, `viewBox="0 0 ${width} ${height + 30}"`)
    .replace(/<\/svg>\s*$/, `${parts.join("\n  ")}\n</svg>`);
};

export interface ChartMeta {
  title: string;
  subtitle: string;
  /** Provenance line: when it was generated, from which revision. */
  footnote: string;
}

/**
 * Wrap a chart body into a standalone, self-styled SVG document with its own
 * title and provenance line, so the file still explains itself when it is
 * embedded somewhere far from this repository.
 */
const standalone = (svg: string, meta: ChartMeta): string => {
  const match = /<svg viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"([^>]*)>([\s\S]*)<\/svg>/.exec(
    svg,
  );
  if (!match) return svg;
  const [, widthText, heightText, attrs, inner] = match;
  const width = Number(widthText);
  const headroom = 52;
  const footroom = 24;
  const height = Number(heightText) + headroom + footroom;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${attrs}>`,
    `  <title>${meta.title}</title>`,
    `  <style>${SVG_STYLE}</style>`,
    `  <rect class="surface" x="0" y="0" width="100%" height="100%"/>`,
    `  <text class="chart-title" x="20" y="26">${meta.title}</text>`,
    `  <text class="chart-subtitle" x="20" y="44">${meta.subtitle}</text>`,
    `  <g transform="translate(0 ${headroom})">${inner}</g>`,
    `  <text class="chart-footnote" x="20" y="${height - 9}">${meta.footnote}</text>`,
    `</svg>`,
    "",
  ].join("\n");
};

export interface RunCharts {
  costSvg: string;
  speedSvg: string;
  breakdownSvg: string;
  html: string;
}

export interface ChartProvenance {
  /** ISO date the charts were generated. */
  date: string;
  /** Repository the generating revision came from. */
  repository: string;
  /** Commit the generating revision was at. */
  commit: string;
}

export const buildCharts = (report: BenchmarkReport, provenance: ChartProvenance): RunCharts => {
  const summaries = new Map<string, ModelUsageSummary>(
    (report.usageSummary?.perModel ?? []).map((m) => [m.modelId, m]),
  );

  const AXIS_LABELS: Record<string, string> = {
    proper_noun_f1: "Proper nouns",
    proposition_recall: "Recall",
    proposition_precision: "Precision",
    proposition_f1: "F1",
    // Runs scored under earlier versions of the metric:
    terminology_accuracy: "Term recall",
    proposition_coverage: "Proposition coverage",
    proposition_fidelity: "Proposition fidelity",
    no_hallucination: "No hallucination",
    meaning_completeness: "Meaning",
    no_hallucination_or_distortion: "No distortion",
    no_critical_omission: "No omission",
  };

  interface Axis {
    key: string;
    label: string;
    weight: number | undefined;
  }

  // The axis set is whatever the run was scored with, so old runs still render.
  const weights = report.conditions?.weights as Record<string, number> | undefined;
  const AXES: Axis[] = Object.keys(report.leaderboard[0]?.categoryScores ?? {}).map((key) => ({
    key,
    label: AXIS_LABELS[key] ?? key.replace(/_/g, " "),
    weight: weights?.[key],
  }));

  interface Point {
    modelId: string;
    name: string;
    score: number;
    categoryScores: Record<string, number>;
    costPerHour: number | undefined;
    asrCostUsd: number | undefined;
    judgeCostUsd: number | undefined;
    estimated: boolean;
    latencyMs: number;
    rtf: number | undefined;
    audioHours: number;
  }

  const points: Point[] = report.leaderboard.map((entry) => {
    const usage = summaries.get(entry.modelId);
    const audioHours = (usage?.audioSeconds ?? 0) / 3600;
    const asrCostUsd = usage?.asrCostUsd;
    return {
      modelId: entry.modelId,
      name: entry.displayName,
      score: entry.overallScore,
      categoryScores: entry.categoryScores,
      costPerHour: asrCostUsd !== undefined && audioHours > 0 ? asrCostUsd / audioHours : undefined,
      asrCostUsd,
      judgeCostUsd: usage?.judgeCostUsd,
      estimated: usage?.asrCostEstimated === true,
      latencyMs: entry.averageLatencyMs,
      rtf: entry.averageRtf,
      audioHours,
    };
  });

  const esc = (s: unknown): string =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtUsd = (v: number | undefined): string =>
    v === undefined ? "-" : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;

  // Round an axis up to a readable step (1, 2, 2.5 or 5 x 10^k).
  const niceStep = (rawMax: number, targetTicks: number): number => {
    const rough = rawMax / targetTicks;
    const mag = 10 ** Math.floor(Math.log10(rough));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((step) => step >= rough) ?? 10 * mag;
  };
  const ticksTo = (max: number, step: number): number[] =>
    Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  /**
   * Ids of the non-dominated points: nothing else is both cheaper/faster and at
   * least as accurate. Returned as a set because a point sits on one chart's
   * frontier and not necessarily on the other's.
   */
  const frontierIds = (list: Point[], xOf: (p: Point) => number): Set<string> =>
    new Set(
      list
        .filter(
          (p) =>
            !list.some(
              (q) =>
                q !== p &&
                xOf(q) <= xOf(p) &&
                q.score >= p.score &&
                (xOf(q) < xOf(p) || q.score > p.score),
            ),
        )
        .map((p) => p.modelId),
    );

  // Keep dense multi-model runs readable instead of squeezing every label into
  // the six-model width used by the original report.
  const W = Math.max(760, points.length * 120);
  const BREAKDOWN_W = Math.max(W, points.length * 150);
  const H = 430;

  /** Scatter of score against a lower-is-better measure, with the Pareto staircase. */
  interface ScatterOptions {
    id: string;
    xOf: (p: Point) => number | undefined;
    xFormat: (v: number) => string;
    xTitle: string;
    tipLine: (p: Point) => string;
    emptyMessage?: string;
  }

  const scatter = ({ id, xOf, xFormat, xTitle, tipLine, emptyMessage }: ScatterOptions) => {
    const data = points.filter((p) => xOf(p) !== undefined && xOf(p) !== null);
    // Narrowed once here: everything below runs on points that do have a value.
    const at = (p: Point): number => xOf(p) ?? 0;
    const onFrontier = frontierIds(data, at);
    const M = { top: 34, right: 54, bottom: 62, left: 66 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;

    if (data.length === 0) {
      return {
        data,
        onFrontier,
        svg: `  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="No data for ${esc(xTitle)}" id="${id}">
    <text class="chart-subtitle" x="${W / 2}" y="${H / 2}" text-anchor="middle">${esc(emptyMessage ?? "No comparable measurements are available.")}</text>
  </svg>`,
      };
    }

    const maxX = Math.max(...data.map(at));
    const xStep = niceStep(maxX * 1.15, 4);
    const xMax = Math.ceil((maxX * 1.12) / xStep) * xStep;
    const maxScore = Math.max(...data.map((p) => p.score));
    const yStep = niceStep(Math.min(100, maxScore + 8), 4);
    const yMax = Math.min(100, Math.ceil((maxScore + 6) / yStep) * yStep);

    const x = (v: number) => M.left + (v / xMax) * plotW;
    const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

    const frontier = data.filter((p) => onFrontier.has(p.modelId)).sort((a, b) => at(a) - at(b));
    const stepPath = frontier
      .flatMap((p, i) => {
        const next = frontier[i + 1];
        const seg = [`${i === 0 ? "M" : "L"}${x(at(p)).toFixed(1)},${y(p.score).toFixed(1)}`];
        if (next) seg.push(`L${x(at(next)).toFixed(1)},${y(p.score).toFixed(1)}`);
        return seg;
      })
      .join(" ");

    // Direct labels sit above the dot and step further away until they clear both
    // the labels already placed and every dot: models with near-identical RTF sit
    // on top of each other, and a label printed across a mark is worse than one
    // placed further out.
    const placed: Array<{ y: number; left: number; right: number }> = [];
    const dots = data.map((p) => ({
      y: y(p.score),
      left: x(at(p)) - 10,
      right: x(at(p)) + 10,
    }));
    const CHAR_W = 6.6;
    const OFFSETS = [-14, 22, -30, 38, -46, 54, -62, 70, -78, 86];

    const placeLabel = (p: Point) => {
      const cx = x(at(p));
      const cy = y(p.score);
      const half = (p.name.length * CHAR_W) / 2;
      let anchor = "middle";
      let lx = cx;
      if (cx - half < M.left) {
        anchor = "start";
        lx = cx - 6;
      } else if (cx + half > M.left + plotW) {
        anchor = "end";
        lx = cx + 6;
      }
      const left = anchor === "start" ? lx : anchor === "end" ? lx - half * 2 : cx - half;
      const right = left + half * 2;
      const overlapsX = (box: { left: number; right: number }) =>
        right > box.left - 6 && left < box.right + 6;
      const free = (candidate: number) =>
        // A 12px label centred on its baseline still touches a mark ~13px away.
        !placed.some((q) => Math.abs(q.y - candidate) < 14 && overlapsX(q)) &&
        !dots.some((d) => Math.abs(d.y - candidate) < 15 && overlapsX(d));

      const candidates = OFFSETS.map((d) => cy + d);
      // When every slot is taken - a cluster of models with near-identical values -
      // fall back to the position that is furthest from the labels already placed,
      // rather than to the last slot, which is where labels used to land on top of
      // each other.
      const ly =
        candidates.find(free) ??
        candidates.reduce((best, candidate) => {
          const clearance = (v: number) =>
            Math.min(
              ...placed.filter(overlapsX).map((q) => Math.abs(q.y - v)),
              Number.POSITIVE_INFINITY,
            );
          return clearance(candidate) > clearance(best) ? candidate : best;
        }, candidates[0]!);
      placed.push({ y: ly, left, right });
      return { lx, ly, anchor };
    };

    const marks = [...data]
      .sort((a, b) => b.score - a.score)
      .map((p) => {
        const cx = x(at(p));
        const cy = y(p.score);
        const label = placeLabel(p);
        const tip = [
          p.name,
          `Score: ${p.score.toFixed(1)}%`,
          tipLine(p),
          `Latency: ${p.latencyMs} ms | RTF: ${p.rtf?.toFixed(2) ?? "-"}x`,
        ].join("\n");
        return `      <g class="mark ${onFrontier.has(p.modelId) ? "on" : "off"}" tabindex="0">
        <title>${esc(tip)}</title>
        <circle class="hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="18"></circle>
        <circle class="dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7"></circle>
        <text class="point-label" x="${label.lx.toFixed(1)}" y="${label.ly.toFixed(1)}" text-anchor="${label.anchor}">${esc(p.name)}</text>
      </g>`;
      })
      .join("\n");

    return {
      data,
      onFrontier,
      svg: `  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score against ${esc(xTitle)}" id="${id}">
    <g class="grid">
${ticksTo(yMax, yStep)
  .map(
    (t) =>
      `      <line x1="${M.left}" y1="${y(t).toFixed(1)}" x2="${M.left + plotW}" y2="${y(t).toFixed(1)}"></line>`,
  )
  .join("\n")}
    </g>
    <g class="axis">
${ticksTo(xMax, xStep)
  .map(
    (t) =>
      `      <text x="${x(t).toFixed(1)}" y="${M.top + plotH + 20}" text-anchor="middle">${xFormat(t)}</text>`,
  )
  .join("\n")}
${ticksTo(yMax, yStep)
  .map(
    (t) =>
      `      <text x="${M.left - 12}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t.toFixed(0)}%</text>`,
  )
  .join("\n")}
      <text class="axis-title" x="${(M.left + plotW / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">${esc(xTitle)}</text>
      <text class="axis-title" transform="translate(16 ${(M.top + plotH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle">Overall score</text>
    </g>
    <path class="frontier" d="${stepPath}"></path>
${marks}
  </svg>`,
    };
  };

  /** Grouped bars: one group per model, one bar per evaluation axis. */
  const breakdownBars = () => {
    const BH = 400;
    const M = { top: 24, right: 24, bottom: 74, left: 56 };
    const plotW = BREAKDOWN_W - M.left - M.right;
    const plotH = BH - M.top - M.bottom;
    const yMax = 100;
    const yStep = 25;
    const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

    const groupW = plotW / points.length;
    const barGap = 2;
    const barW = (groupW * 0.78 - barGap * (AXES.length - 1)) / AXES.length;

    const groups = points
      .map((p, gi) => {
        const gx = M.left + groupW * gi + groupW * 0.11;
        const bars = AXES.map((axis, ai) => {
          const v = p.categoryScores[axis.key] ?? 0;
          const bx = gx + ai * (barW + barGap);
          const by = y(v);
          const h = Math.max(M.top + plotH - by, 1);
          return `        <g class="bar s${ai + 1}" tabindex="0">
          <title>${esc(`${p.name}\n${axis.label}${axis.weight === undefined ? "" : ` (weight ${axis.weight})`}: ${v.toFixed(1)}%`)}</title>
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"></rect>
          <rect class="foot" x="${bx.toFixed(1)}" y="${(M.top + plotH - 4).toFixed(1)}" width="${barW.toFixed(1)}" height="4"></rect>
        </g>`;
        }).join("\n");

        // Wrap long model names onto two lines under the group.
        const words = p.name.split(" ");
        const mid = Math.ceil(words.length / 2);
        const l1 = words.length > 1 ? words.slice(0, mid).join(" ") : p.name;
        const l2 = words.length > 1 ? words.slice(mid).join(" ") : "";
        const cx = M.left + groupW * gi + groupW / 2;
        return `      <g class="group">
${bars}
        <text class="group-label" x="${cx.toFixed(1)}" y="${M.top + plotH + 20}" text-anchor="middle">${esc(l1)}<tspan x="${cx.toFixed(1)}" dy="14">${esc(l2)}</tspan></text>
      </g>`;
      })
      .join("\n");

    return `  <svg viewBox="0 0 ${BREAKDOWN_W} ${BH}" role="img" aria-label="Score by evaluation axis for each model">
    <g class="grid">
${ticksTo(yMax, yStep)
  .map(
    (t) =>
      `      <line x1="${M.left}" y1="${y(t).toFixed(1)}" x2="${M.left + plotW}" y2="${y(t).toFixed(1)}"></line>`,
  )
  .join("\n")}
    </g>
    <g class="axis">
${ticksTo(yMax, yStep)
  .map(
    (t) =>
      `      <text x="${M.left - 12}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}%</text>`,
  )
  .join("\n")}
    </g>
${groups}
  </svg>`;
  };

  const costChart = scatter({
    id: "cost-chart",
    xOf: (p) => p.costPerHour,
    xFormat: (t) => `$${t.toFixed(2)}`,
    xTitle: "ASR cost per hour of audio (USD)",
    emptyMessage: "No models in this run have a calculable ASR price.",
    tipLine: (p) =>
      `Cost: ${fmtUsd(p.costPerHour)}${p.estimated ? " (est.)" : ""} / audio hour  ·  run: ${fmtUsd(p.asrCostUsd)}`,
  });
  const speedChart = scatter({
    id: "speed-chart",
    xOf: (p) => p.rtf,
    xFormat: (t) => `${t.toFixed(2)}x`,
    xTitle: "RTF - processing time ÷ audio length (lower is faster)",
    tipLine: (p) => `RTF: ${p.rtf?.toFixed(3) ?? "-"}x  ·  avg latency ${p.latencyMs} ms`,
  });

  const rows = points
    .map((p) => {
      const onCost = costChart.onFrontier.has(p.modelId);
      const onSpeed = speedChart.onFrontier.has(p.modelId);
      return `        <tr>
          <td>${esc(p.name)}</td>
          <td>${p.score.toFixed(1)}%</td>
${AXES.map((a) => `          <td>${(p.categoryScores[a.key] ?? 0).toFixed(1)}%</td>`).join("\n")}
          <td>${fmtUsd(p.costPerHour)}${p.estimated ? " ~" : ""}</td>
          <td>${p.rtf?.toFixed(2) ?? "-"}x</td>
          <td>${onCost ? "✔" : ""}${onCost && onSpeed ? " " : ""}${onSpeed ? "⚡" : ""}</td>
        </tr>`;
    })
    .join("\n");

  const audioMin = points[0]?.audioHours ? (points[0].audioHours * 60).toFixed(0) : "?";
  const sampleCount =
    report.conditions?.sampleCount ?? new Set(report.evaluations.map((e) => e.sampleId)).size;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kikitori-bench charts - ${esc(report.runId)}</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #78776f;
    --grid: #e6e5e0;
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #96958c;
      --grid: #333330;
      --series-1: #3987e5;
      --series-2: #d95926;
      --series-3: #199e70;
      --series-4: #c98500;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #96958c;
    --grid: #333330;
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
  }
  body {
    margin: 0;
    padding: 24px;
    background: var(--surface-1);
    color: var(--text-primary);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif;
  }
  .wrap { max-width: ${Math.max(820, BREAKDOWN_W)}px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 34px 0 2px; }
  .sub { color: var(--text-secondary); font-size: 13px; margin: 0 0 6px; }
  section { border-top: 1px solid var(--grid); padding-top: 10px; margin-top: 26px; }
  section:first-of-type { border-top: none; }
  .chart { overflow-x: auto; }
  svg { display: block; max-width: 100%; height: auto; }
  .grid line { stroke: var(--grid); stroke-width: 1; }
  .axis text { fill: var(--text-secondary); font-size: 11px; }
  .axis-title { fill: var(--text-secondary); font-size: 12px; }
  .chart-subtitle { fill: var(--text-secondary); font-size: 12px; }
  .group-label { fill: var(--text-secondary); font-size: 11px; }
  .frontier { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-dasharray: 5 4; opacity: .85; }
  .hit { fill: transparent; }
  .mark .dot { stroke: var(--series-1); stroke-width: 2; }
  .mark.on .dot { fill: var(--series-1); }
  .mark.off .dot { fill: var(--surface-1); opacity: .9; }
  .mark:hover .dot, .mark:focus .dot { r: 9; }
  .mark:focus, .bar:focus { outline: none; }
  .point-label { fill: var(--text-primary); font-size: 12px; font-weight: 500; }
  .bar rect { fill: var(--series-1); }
  .bar.s2 rect { fill: var(--series-2); }
  .bar.s3 rect { fill: var(--series-3); }
  .bar.s4 rect { fill: var(--series-4); }
  .bar:hover rect, .bar:focus rect { opacity: .78; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 10px 0 0; color: var(--text-secondary); font-size: 12px; }
  .swatch { display: inline-block; width: 11px; height: 11px; border-radius: 3px; vertical-align: -1px; margin-right: 6px; }
  .swatch.dot-on, .swatch.dot-off { border-radius: 50%; border: 2px solid var(--series-1); }
  .swatch.dot-on { background: var(--series-1); }
  .swatch.dot-off { background: var(--surface-1); }
  .swatch.s1 { background: var(--series-1); }
  .swatch.s2 { background: var(--series-2); }
  .swatch.s3 { background: var(--series-3); }
  .swatch.s4 { background: var(--series-4); }
  table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 12.5px; }
  th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--grid); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--text-secondary); font-weight: 600; }
  .note { color: var(--text-muted); font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>kikitori-bench &mdash; ${esc(report.datasetName)}</h1>
  <p class="sub">${sampleCount} samples &middot; ${audioMin} min of audio per model &middot; judge: ${esc(report.judgeModel)} &middot; run <code>${esc(report.runId)}</code></p>

  <section>
    <h2>1. Price / performance</h2>
    <p class="sub">Cheaper is left, better is up. The staircase is the Pareto frontier.</p>
    <div class="chart">
${costChart.svg}
    </div>
    ${
      costChart.data.length > 0
        ? `<p class="legend">
      <span><span class="swatch dot-on"></span>On the frontier</span>
      <span><span class="swatch dot-off"></span>Dominated (something is cheaper and better)</span>
    </p>`
        : ""
    }
    <p class="note">Price is ASR spend only &mdash; the LLM-as-a-judge cost is the same work for every model and is not a property of the model under test. Models without a calculable ASR price are excluded from this chart and its frontier. <code>~</code> marks a cost estimated from audio length where the provider reports no token counts.</p>
  </section>

  <section>
    <h2>2. Speed / performance</h2>
    <p class="sub">RTF is wall-clock processing time divided by audio length; faster is left.</p>
    <div class="chart">
${speedChart.svg}
    </div>
    <p class="legend">
      <span><span class="swatch dot-on"></span>On the frontier</span>
      <span><span class="swatch dot-off"></span>Dominated (something is faster and better)</span>
    </p>
    <p class="note">RTF uses the latency boundary reported by each adapter; consult Experiment Conditions for model-specific timing. Batch concurrency can affect adapters whose measurement includes queueing.</p>
  </section>

  <section>
    <h2>3. Score by evaluation axis</h2>
    <p class="sub">Claim-level checks (per expected term, per key point, per unsupported insertion), averaged over the dataset.</p>
    <div class="chart">
${breakdownBars()}
    </div>
    <p class="legend">
${AXES.map((a, i) => `      <span><span class="swatch s${i + 1}"></span>${esc(a.label)}${a.weight === undefined ? "" : ` (${Math.round(a.weight * 100)}%)`}</span>`).join("\n")}
    </p>
  </section>

  <section>
    <h2>Data</h2>
    <table>
      <thead>
        <tr><th>Model</th><th>Overall</th>${AXES.map((a) => `<th>${esc(a.label)}</th>`).join("")}<th>USD / audio h</th><th>RTF</th><th>Frontier</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <p class="note">Frontier column: ✔ price/performance, ⚡ speed/performance. A model with <code>-</code> under USD / audio h is excluded from price/performance only.</p>
  </section>
</div>
</body>
</html>
`;

  const frontierLegend: LegendItem[] = [
    { shape: "dot-on", label: "On the Pareto frontier" },
    { shape: "dot-off", label: "Dominated" },
  ];
  const axisLegend: LegendItem[] = AXES.map((axis, i) => ({
    shape: "swatch" as const,
    label: axis.label,
    className: `s${i + 1}`,
  }));

  const subtitle = `${sampleCount} samples · ${audioMin} min of audio per model · judge ${esc(report.judgeModel)}`;
  const footnote = `${provenance.date} · ${provenance.repository} @ ${provenance.commit}`;

  return {
    costSvg: standalone(
      withLegend(costChart.svg, costChart.data.length > 0 ? frontierLegend : []),
      {
        title: "Japanese voice-journal ASR: price versus score",
        subtitle,
        footnote,
      },
    ),
    speedSvg: standalone(withLegend(speedChart.svg, frontierLegend), {
      title: "Japanese voice-journal ASR: speed versus score",
      subtitle,
      footnote,
    }),
    breakdownSvg: standalone(withLegend(breakdownBars(), axisLegend), {
      title: "Japanese voice-journal ASR: score by evaluation axis",
      subtitle,
      footnote,
    }),
    html,
  };
};
