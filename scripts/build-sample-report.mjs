import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

/**
 * Builds the offline sample report Power BI Desktop project (PBIP + PBIR + TMDL).
 *
 * Microsoft requires an offline sample report for an AppSource submission, but a `.pbix`
 * cannot be produced headlessly: its `DataModel` part is a binary Analysis Services backup
 * image. This generator emits the fully text-based project instead, which Power BI Desktop
 * opens directly and can then be saved as `.pbix` in one step.
 *
 * Everything here is deterministic: identifiers are derived from SHA-256 of fixed seeds and
 * the data is the same module that feeds the screenshots and the sample CSV, so
 * `npm run audit:submission` can regenerate the project and fail on any drift.
 *
 * Schema URLs below are pinned against https://github.com/microsoft/json-schemas.
 */

export const SAMPLE_SLUG = "AtlynSample";
export const SAMPLE_DISPLAY_NAME = "Atlyn Distribution Sample";
export const SAMPLE_ROOT = "samples";
export const TABLE_NAME = "Measurements";
export const PAGE_DISPLAY_NAME = "Cycle time distribution";
export const VISUAL_TITLE = "Cycle time distribution by production line";

export const SCHEMAS = {
  pbip: "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
  platform: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
  reportDefinition: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
  semanticModelDefinition: "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
  versionMetadata: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
  report: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.0.0/schema.json",
  pagesMetadata: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
  page: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json",
  visualContainer: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json",
};

const reportFolder = `${SAMPLE_SLUG}.Report`;
const semanticModelFolder = `${SAMPLE_SLUG}.SemanticModel`;

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const digest = (seed) => createHash("sha256").update(`atlyn-distribution-sample::${seed}`).digest("hex");

/** Stable 32-character identifier, matching the shape Power BI uses for page/visual names. */
const stableId = (seed) => digest(seed).slice(0, 32);

/** Stable RFC-4122-shaped identifier for logicalId and lineageTag values. */
const stableGuid = (seed) => {
  const hex = digest(seed);
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const platform = (type) => json({
  $schema: SCHEMAS.platform,
  metadata: { type, displayName: SAMPLE_DISPLAY_NAME },
  config: { version: "2.0", logicalId: stableGuid(`platform:${type}`) },
});

const columnProjection = (column) => ({
  projections: [{
    field: {
      Column: {
        Expression: { SourceRef: { Entity: TABLE_NAME } },
        Property: column,
      },
    },
    queryRef: `${TABLE_NAME}.${column}`,
    nativeQueryRef: column,
  }],
});

/**
 * Every projection is a plain `Column`, never an `Aggregation`. Atlyn Distribution plots raw
 * observations, so an aggregated Value would break its data contract - this is the PBIR
 * equivalent of setting the field to "Don't summarize" in Power BI Desktop. Each key must
 * match a dataRoles[].name in capabilities.json.
 */
const buildQueryState = () => ({
  Category: columnProjection("Category"),
  Sample: columnProjection("Sample"),
  Value: columnProjection("Value"),
});

const escapeDax = (value) => String(value).replaceAll('"', '""');

/**
 * A DAX calculated table, not a Power Query partition.
 *
 * An M partition would still be a query that the model refreshes, even with a literal
 * `#table(...)` source. A calculated table has no data source object at all, so there is
 * nothing to prompt for credentials and nothing to refresh - which is what Microsoft's
 * "works offline with no external connections" requirement actually asks for.
 */
const buildDataTable = (rows) => {
  const literals = rows.map((row, index) => {
    const separator = index === rows.length - 1 ? "" : ",";
    return `        {"${escapeDax(row.category)}", "${escapeDax(row.sample)}", ${row.value.toFixed(1)}}${separator}`;
  });
  return [
    "DATATABLE(",
    '    "Category", STRING,',
    '    "Sample", STRING,',
    '    "Value", DOUBLE,',
    "    {",
    ...literals,
    "    }",
    ")",
  ];
};

const buildTable = (rows) => {
  const indent = "\t\t\t";
  return [
    `/// Offline sample observations used to demonstrate the visual.`,
    `table ${TABLE_NAME}`,
    `\tlineageTag: ${stableGuid("table:Measurements")}`,
    "",
    "\tcolumn Category",
    "\t\tdataType: string",
    "\t\tisNameInferred",
    `\t\tlineageTag: ${stableGuid("column:Category")}`,
    "\t\tsummarizeBy: none",
    "\t\tsourceColumn: [Category]",
    "",
    "\t\tannotation SummarizationSetBy = Automatic",
    "",
    "\tcolumn Sample",
    "\t\tdataType: string",
    "\t\tisNameInferred",
    `\t\tlineageTag: ${stableGuid("column:Sample")}`,
    "\t\tsummarizeBy: none",
    "\t\tsourceColumn: [Sample]",
    "",
    "\t\tannotation SummarizationSetBy = Automatic",
    "",
    "\tcolumn Value",
    "\t\tdataType: double",
    "\t\tformatString: 0.0",
    "\t\tisNameInferred",
    `\t\tlineageTag: ${stableGuid("column:Value")}`,
    // Don't summarize: this visual plots raw observations, so it must not receive an aggregate.
    "\t\tsummarizeBy: none",
    "\t\tsourceColumn: [Value]",
    "",
    "\t\tannotation SummarizationSetBy = User",
    "",
    `\tpartition ${TABLE_NAME} = calculated`,
    "\t\tmode: import",
    "\t\tsource =",
    ...buildDataTable(rows).map((line) => `${indent}${line}`),
    "",
  ].join("\n");
};

/** Reads the two files that make a private custom visual render offline. */
const readPackagedVisual = async (root, guid, version) => {
  const artifactPath = path.join(root, "dist", `${guid}.${version}.pbiviz`);
  if (!existsSync(artifactPath)) {
    return undefined;
  }
  const archive = await JSZip.loadAsync(readFileSync(artifactPath));
  const manifest = archive.file("package.json");
  const resource = archive.file(`resources/${guid}.pbiviz.json`);
  ensure(manifest && resource, `Packaged visual at dist/${guid}.${version}.pbiviz is missing expected entries.`);
  return {
    manifest: await manifest.async("string"),
    resource: await resource.async("string"),
  };
};

/**
 * @param {{ root?: string, includeCustomVisual?: boolean }} [options]
 * @returns {Promise<Map<string, string>>} posix repo-relative path -> file contents
 */
export async function buildSampleReportFiles(options = {}) {
  const root = options.root ?? process.cwd();
  const includeCustomVisual = options.includeCustomVisual ?? true;

  const pbiviz = JSON.parse(readFileSync(path.join(root, "pbiviz.json"), "utf8"));
  const guid = pbiviz.visual.guid;
  const { buildSampleRows } = await import(pathToFileURL(
    path.join(root, "tools", "screenshots", "sample-data.mjs"),
  ).href);
  const rows = buildSampleRows();
  ensure(rows.length > 0, "Sample data module produced no rows.");

  const pageId = stableId("page:distribution");
  const visualId = stableId("visual:distribution");
  const files = new Map();
  const add = (relativePath, contents) => files.set(relativePath, contents);

  add(`${SAMPLE_ROOT}/${SAMPLE_SLUG}.pbip`, json({
    $schema: SCHEMAS.pbip,
    version: "1.0",
    artifacts: [{ report: { path: reportFolder } }],
    settings: { enableAutoRecovery: true },
  }));

  add(`${SAMPLE_ROOT}/.gitignore`, ["**/.pbi/localSettings.json", "**/.pbi/cache.abf", ""].join("\n"));

  // Semantic model: TMDL, inline literal data only.
  add(`${SAMPLE_ROOT}/${semanticModelFolder}/.platform`, platform("SemanticModel"));
  add(`${SAMPLE_ROOT}/${semanticModelFolder}/definition.pbism`, json({
    $schema: SCHEMAS.semanticModelDefinition,
    version: "4.2",
    settings: { qnaEnabled: false },
  }));
  add(`${SAMPLE_ROOT}/${semanticModelFolder}/definition/database.tmdl`, [
    "database",
    "\tcompatibilityLevel: 1550",
    "",
  ].join("\n"));
  add(`${SAMPLE_ROOT}/${semanticModelFolder}/definition/model.tmdl`, [
    "model Model",
    "\tculture: en-US",
    "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
    "\tsourceQueryCulture: en-US",
    "",
    `ref table ${TABLE_NAME}`,
    "",
  ].join("\n"));
  add(`${SAMPLE_ROOT}/${semanticModelFolder}/definition/tables/${TABLE_NAME}.tmdl`, buildTable(rows));

  // Report: PBIR.
  add(`${SAMPLE_ROOT}/${reportFolder}/.platform`, platform("Report"));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition.pbir`, json({
    $schema: SCHEMAS.reportDefinition,
    version: "4.0",
    datasetReference: { byPath: { path: `../${semanticModelFolder}` } },
  }));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition/version.json`, json({
    $schema: SCHEMAS.versionMetadata,
    version: "2.0.0",
  }));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition/report.json`, json({
    $schema: SCHEMAS.report,
    themeCollection: {
      baseTheme: { name: "CY24SU10", reportVersionAtImport: "5.55", type: "SharedResources" },
    },
    // A CustomVisual resource package embeds the visual in the report. publicCustomVisuals is
    // deliberately absent: it resolves from the AppSource store, which is not offline.
    resourcePackages: [
      {
        name: guid,
        type: "CustomVisual",
        items: [{
          name: `${guid}.pbiviz.json`,
          path: `${guid}.pbiviz.json`,
          type: "CustomVisualMetadata",
        }],
      },
      {
        name: "SharedResources",
        type: "SharedResources",
        items: [{ name: "CY24SU10", path: "BaseThemes/CY24SU10.json", type: "BaseTheme" }],
      },
    ],
    settings: {
      useStylableVisualContainerHeader: true,
      defaultDrillFilterOtherVisuals: true,
    },
  }));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition/pages/pages.json`, json({
    $schema: SCHEMAS.pagesMetadata,
    pageOrder: [pageId],
    activePageName: pageId,
  }));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition/pages/${pageId}/page.json`, json({
    $schema: SCHEMAS.page,
    name: pageId,
    displayName: PAGE_DISPLAY_NAME,
    displayOption: "FitToPage",
    height: 720,
    width: 1280,
  }));
  add(`${SAMPLE_ROOT}/${reportFolder}/definition/pages/${pageId}/visuals/${visualId}/visual.json`, json({
    $schema: SCHEMAS.visualContainer,
    name: visualId,
    position: { x: 40, y: 40, z: 0, height: 620, width: 1200, tabOrder: 0 },
    visual: {
      visualType: guid,
      query: { queryState: buildQueryState() },
      visualContainerObjects: {
        title: [{ properties: { text: { expr: { Literal: { Value: `'${VISUAL_TITLE}'` } } } } }],
      },
      drillFilterOtherVisuals: true,
    },
  }));

  if (includeCustomVisual) {
    const packaged = await readPackagedVisual(root, guid, pbiviz.visual.version);
    if (packaged) {
      add(`${SAMPLE_ROOT}/${reportFolder}/CustomVisuals/${guid}/package.json`, packaged.manifest);
      add(`${SAMPLE_ROOT}/${reportFolder}/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`, packaged.resource);
    }
  }

  add(`${SAMPLE_ROOT}/README.md`, [
    "# Atlyn Distribution offline sample report",
    "",
    `\`${SAMPLE_SLUG}.pbip\` is the Microsoft-required sample report for the AppSource`,
    "submission. It is a Power BI Desktop project stored in the documented PBIR",
    "(report) and TMDL (semantic model) text formats, emitted directly by",
    "`scripts/build-sample-report.mjs` with no third-party tooling.",
    "",
    "- The semantic model holds all 200 rows in a **DAX calculated table**",
    "  (`DATATABLE(...)`). There is no Power Query partition and no data source object,",
    "  so there is nothing to authenticate and nothing to connect to. The table still",
    "  has to be evaluated before it holds rows - see the check below.",
    "- The visual is embedded as a private custom visual under",
    `  \`${reportFolder}/CustomVisuals/\`, so the report renders with no AppSource lookup.`,
    "",
    "Regenerate with `npm run package` then `npm run sample-report`.",
    "`npm run audit:submission` fails if the checked-in project drifts from the generator.",
    "",
    "## Producing the `.pbix`",
    "",
    `1. Open \`${SAMPLE_SLUG}.pbip\` in Power BI Desktop and **confirm the visual renders`,
    "   with data** - the diagnostics line should report 200 received and 200 rendered",
    "   rows.",
    '2. If any table is empty, or Desktop reports *"Some of the tables have incomplete or',
    '   no data"*, run **Home > Refresh > Schema and data** and re-check. The committed',
    "   project carries no cached model data. Whether Desktop evaluates this calculated",
    "   table on open has not been verified, so check rather than assume - saving while",
    "   the tables are empty ships a `.pbix` with no data, which fails AppSource review.",
    "3. **File > Save As** a `.pbix`, then re-open it and confirm the visual still",
    "   renders 200 rows.",
    "",
    "If Desktop ever prompts for credentials, authentication, or a data source, something",
    "external has entered the model and the sample is no longer offline. Stop and",
    "investigate.",
    "",
    "See `docs/partner-center-submission.md` section 4.1 for the full procedure.",
    "",
  ].join("\n"));

  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  const files = await buildSampleReportFiles({ root });
  const target = path.join(root, SAMPLE_ROOT);
  rmSync(target, { recursive: true, force: true });
  for (const [relativePath, contents] of files) {
    const absolute = path.join(root, relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  const embedded = [...files.keys()].some((key) => key.includes("/CustomVisuals/"));
  console.log(`Wrote ${files.size} file(s) into ${SAMPLE_ROOT}/`);
  if (!embedded) {
    console.warn(
      "! The built visual was not found in dist/, so the report has no embedded custom visual.\n"
      + "  Run `npm run package` first, then re-run this script.",
    );
  }
}
