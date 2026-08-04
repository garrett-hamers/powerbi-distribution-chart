import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Writes `assets/sample-data/atlyn-distribution-sample.csv` from the same deterministic
 * module that feeds the screenshot harness, so the committed dataset and the committed
 * screenshots always describe the same numbers. `npm run audit:submission` re-runs this
 * generator in memory and fails if the checked-in CSV has drifted.
 */

const root = process.cwd();
const outputPath = path.join(root, "assets", "sample-data", "atlyn-distribution-sample.csv");

export async function buildSampleCsv(repositoryRoot = process.cwd()) {
  const module = await import(pathToFileURL(
    path.join(repositoryRoot, "tools", "screenshots", "sample-data.mjs"),
  ).href);
  const header = "Category,Sample,Value";
  const rows = module.buildSampleRows().map((row) => `${row.category},${row.sample},${row.value.toFixed(1)}`);
  return `${[header, ...rows].join("\r\n")}\r\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const csv = await buildSampleCsv(root);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, csv, "utf8");
  console.log(`Wrote ${path.relative(root, outputPath).replaceAll("\\", "/")} (${csv.split("\r\n").length - 2} rows)`);
}
