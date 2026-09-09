#!/usr/bin/env node
// Local, interactive view of a run:
//   pnpm tsx scripts/plot-charts.ts <runId> [outPath]
// Writes to reports/ (git-ignored) because the HTML page is only for looking at
// results on this machine; `kikitori publish` is what produces committable output.
import * as fs from "node:fs";
import * as path from "node:path";
import { buildCharts } from "../src/services/Charts.js";
import { chartProvenance } from "../src/services/Publisher.js";
import type { BenchmarkReport } from "../src/schemas/judge.js";

const runId = process.argv[2];
if (!runId) {
  console.error("usage: pnpm tsx scripts/plot-charts.ts <runId> [outPath]");
  process.exit(1);
}

const report = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "runs", runId, "evaluation_report.json"), "utf-8"),
) as BenchmarkReport;

const outPath = process.argv[3] ?? path.resolve(process.cwd(), "reports", `${runId}-charts.html`);
fs.writeFileSync(outPath, buildCharts(report, chartProvenance()).html, "utf-8");
console.log(`Charts written to ${outPath}`);
