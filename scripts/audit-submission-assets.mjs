import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { hasPngSignature, readPngHeader } from "./png-utils.mjs";
import { buildSampleCsv } from "./write-sample-dataset.mjs";
import { SAMPLE_SLUG, buildSampleReportFiles } from "./build-sample-report.mjs";

/**
 * Deterministic gate for the Microsoft AppSource / Partner Center submission assets.
 *
 * Every rule here maps to a published Partner Center requirement for Power BI visuals:
 * https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store
 *
 * Power BI Desktop is the only supported author of the sample .pbix report. Once Desktop
 * has produced it, this gate requires the committed binary to remain present.
 */

const LOGO_SIZE = 300;
const ICON_SIZE = 20;
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const MIN_SCREENSHOTS = 1;
const MAX_SCREENSHOTS = 5;
const FROZEN_GUID = "atlynDistributionA1B2C3D4E5F6G7H8I9J0";
const DISTRIBUTION_PAGE_NAME = "Cycle time distribution";
const HINTS_PAGE_NAME = "Hints and tips";
const PRIVACY_POLICY_URL = "https://atlyn.io/legal/privacy";
const SUPPORT_URL = "https://atlyn.io/contact";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOUR_PART_VERSION = /^\d+\.\d+\.\d+\.\d+$/;
const EXTERNAL_SOURCE_TOKENS = [
  "Sql.Database",
  "Web.Contents",
  "File.Contents",
  "Csv.Document",
  "Excel.Workbook",
  "OData.Feed",
  "Folder.Files",
  "SharePoint",
  "Odbc.",
];
const EXTERNAL_URL_PATTERN = /\bhttps?:\/\//;

const root = process.cwd();
const relative = (target) => path.relative(root, target).replaceAll("\\", "/");

const failures = [];
const checks = [];

const check = async (label, assertion) => {
  try {
    const detail = await assertion();
    checks.push(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    checks.push(`  FAIL  ${label} - ${error.message}`);
  }
};

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const readJson = (target) => JSON.parse(readFileSync(target, "utf8"));

const requireNonEmptyFile = (target, minimumBytes = 1) => {
  const stats = statSync(target);
  ensure(stats.isFile(), `${relative(target)} is not a file.`);
  ensure(stats.size >= minimumBytes, `${relative(target)} is only ${stats.size} bytes.`);
  return stats.size;
};

const pbivizPath = path.join(root, "pbiviz.json");
const pbiviz = readJson(pbivizPath);
const visual = pbiviz.visual ?? {};
const author = pbiviz.author ?? {};

await check("pbiviz.json declares a visual name", () => {
  ensure(typeof visual.name === "string" && visual.name.trim().length > 0, "visual.name is missing.");
  return visual.name;
});

await check("pbiviz.json declares a display name", () => {
  ensure(
    typeof visual.displayName === "string" && visual.displayName.trim().length > 0,
    "visual.displayName is missing.",
  );
  return visual.displayName;
});

await check("pbiviz.json keeps the published GUID frozen", () => {
  ensure(
    visual.guid === FROZEN_GUID,
    `visual.guid is "${visual.guid}" but the storefront release manifest records "${FROZEN_GUID}".`,
  );
  return visual.guid;
});

await check("pbiviz.json uses a four-part version", () => {
  ensure(
    FOUR_PART_VERSION.test(String(visual.version)),
    `visual.version "${visual.version}" is not in x.x.x.x form.`,
  );
  return visual.version;
});

await check("pbiviz.json carries a listing description", () => {
  const description = typeof visual.description === "string" ? visual.description.trim() : "";
  ensure(description.length >= 40, "visual.description must be a full sentence of at least 40 characters.");
  ensure(description.length <= 500, `visual.description is ${description.length} characters; keep it under 500.`);
  return `${description.length} characters`;
});

await check("pbiviz.json points supportUrl at the published support page", () => {
  ensure(typeof visual.supportUrl === "string", "visual.supportUrl is missing.");
  ensure(visual.supportUrl.startsWith("https://"), `visual.supportUrl "${visual.supportUrl}" must start with https://.`);
  ensure(
    visual.supportUrl === SUPPORT_URL,
    `visual.supportUrl is "${visual.supportUrl}" but the documented support page is "${SUPPORT_URL}".`,
  );
  return visual.supportUrl;
});

await check("pbiviz.json names the author", () => {
  ensure(typeof author.name === "string" && author.name.trim().length > 0, "author.name is missing.");
  return author.name;
});

await check("pbiviz.json carries a reachable author email", () => {
  ensure(typeof author.email === "string" && EMAIL_PATTERN.test(author.email), `author.email "${author.email}" is not a valid address.`);
  ensure(
    !author.email.endsWith("users.noreply.github.com"),
    "author.email must be a monitored mailbox, not a GitHub noreply address.",
  );
  return author.email;
});

await check("privacy policy URL is https", () => {
  ensure(PRIVACY_POLICY_URL.startsWith("https://"), "The privacy policy URL must start with https://.");
  const dossier = readFileSync(path.join(root, "docs", "partner-center-submission.md"), "utf8");
  ensure(dossier.includes(PRIVACY_POLICY_URL), "The submission dossier does not record the privacy policy URL.");
  return PRIVACY_POLICY_URL;
});

await check(`visual icon is a ${ICON_SIZE}x${ICON_SIZE} PNG`, () => {
  // Microsoft documents the visual icon as "a PNG file with dimensions 20 pixels by 20
  // pixels". powerbi-visuals-tools does not enforce it and hard-codes assets/icon.png into
  // the packaged manifest whatever the source extension is, so this is enforced here.
  ensure(
    visual.name !== undefined && pbiviz.assets?.icon === "assets/icon.png",
    `pbiviz.json assets.icon is "${pbiviz.assets?.icon}"; it must be "assets/icon.png".`,
  );
  const iconPath = path.join(root, "assets", "icon.png");
  const bytes = requireNonEmptyFile(iconPath, 64);
  const buffer = readFileSync(iconPath);
  ensure(hasPngSignature(buffer), `${relative(iconPath)} is not a PNG.`);
  const header = readPngHeader(buffer);
  ensure(
    header.width === ICON_SIZE && header.height === ICON_SIZE,
    `${relative(iconPath)} is ${header.width}x${header.height}, expected ${ICON_SIZE}x${ICON_SIZE}.`,
  );
  return `${header.width}x${header.height}, ${bytes} bytes`;
});

await check(`Partner Center logo is a ${LOGO_SIZE}x${LOGO_SIZE} PNG`, () => {
  const logoPath = path.join(root, "assets", "logo-300x300.png");
  const bytes = requireNonEmptyFile(logoPath, 1024);
  const buffer = readFileSync(logoPath);
  ensure(hasPngSignature(buffer), `${relative(logoPath)} is not a PNG.`);
  const header = readPngHeader(buffer);
  ensure(
    header.width === LOGO_SIZE && header.height === LOGO_SIZE,
    `${relative(logoPath)} is ${header.width}x${header.height}, expected ${LOGO_SIZE}x${LOGO_SIZE}.`,
  );
  return `${header.width}x${header.height}, ${bytes} bytes`;
});

await check(`listing screenshots are ${MIN_SCREENSHOTS}-${MAX_SCREENSHOTS} PNGs at exactly ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}`, () => {
  const screenshotDirectory = path.join(root, "assets", "screenshots");
  const entries = readdirSync(screenshotDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const pngs = entries.filter((name) => name.toLowerCase().endsWith(".png"));
  ensure(
    pngs.length === entries.length,
    `assets/screenshots must contain PNG files only; found ${entries.filter((name) => !pngs.includes(name)).join(", ")}.`,
  );
  ensure(
    pngs.length >= MIN_SCREENSHOTS && pngs.length <= MAX_SCREENSHOTS,
    `AppSource accepts ${MIN_SCREENSHOTS}-${MAX_SCREENSHOTS} screenshots; found ${pngs.length}.`,
  );

  pngs.forEach((name) => {
    const screenshotPath = path.join(screenshotDirectory, name);
    const buffer = readFileSync(screenshotPath);
    ensure(hasPngSignature(buffer), `${relative(screenshotPath)} is not a PNG.`);
    const header = readPngHeader(buffer);
    ensure(
      header.width === SCREENSHOT_WIDTH && header.height === SCREENSHOT_HEIGHT,
      `${relative(screenshotPath)} is ${header.width}x${header.height}, expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}.`,
    );
    ensure(
      buffer.length <= MAX_SCREENSHOT_BYTES,
      `${relative(screenshotPath)} is ${buffer.length} bytes, over the ${MAX_SCREENSHOT_BYTES} byte limit.`,
    );
  });

  return `${pngs.length} screenshots: ${pngs.join(", ")}`;
});

await check("EULA is present", () => {
  const eulaPath = path.join(root, "EULA.md");
  const bytes = requireNonEmptyFile(eulaPath, 512);
  const contents = readFileSync(eulaPath, "utf8");
  ensure(contents.includes(PRIVACY_POLICY_URL), "EULA.md must link the privacy policy.");
  ensure(contents.includes(SUPPORT_URL), "EULA.md must link the support page.");
  return `${bytes} bytes`;
});

await check("submission dossier is present", () => {
  const dossierPath = path.join(root, "docs", "partner-center-submission.md");
  const bytes = requireNonEmptyFile(dossierPath, 512);
  const contents = readFileSync(dossierPath, "utf8");
  [
    FROZEN_GUID,
    SUPPORT_URL,
    PRIVACY_POLICY_URL,
    "EULA.md",
    "assets/logo-300x300.png",
    // The owner-confirmed licensing decision must stay recorded.
    "AppSource listing: Free",
    `samples/${SAMPLE_SLUG}.pbip`,
  ].forEach((token) => {
    ensure(contents.includes(token), `docs/partner-center-submission.md is missing "${token}".`);
  });
  return `${bytes} bytes`;
});

const sampleCsvPath = path.join(root, "assets", "sample-data", "atlyn-distribution-sample.csv");
await check("offline sample dataset matches its deterministic generator", async () => {
  requireNonEmptyFile(sampleCsvPath, 512);
  const normalize = (text) => text.replaceAll("\r\n", "\n");
  const actual = readFileSync(sampleCsvPath, "utf8");
  const expected = await buildSampleCsv(root);
  ensure(
    normalize(actual) === normalize(expected),
    "assets/sample-data/atlyn-distribution-sample.csv is stale; re-run `node scripts/write-sample-dataset.mjs`.",
  );
  const [header, ...rows] = normalize(actual).trim().split("\n");
  ensure(header === "Category,Sample,Value", `Unexpected CSV header "${header}".`);
  return `${rows.length} rows`;
});

await check("offline sample report project matches its deterministic generator", async () => {
  const normalize = (text) => text.replaceAll("\r\n", "\n");
  const expected = await buildSampleReportFiles({ root });
  ensure(expected.size > 0, "Sample report generator produced no files.");

  const packageBuilt = [...expected.keys()].some((key) => key.includes("/CustomVisuals/"));
  const committed = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const relativePath = relative(absolute);
        // Desktop authors this binary after the deterministic PBIP has passed its
        // manual 200/200 check. It is audited separately below, not regenerated.
        if (relativePath === `samples/${SAMPLE_SLUG}.pbix`) {
          continue;
        }
        committed.set(relativePath, readFileSync(absolute, "utf8"));
      }
    }
  };
  ensure(
    existsSync(path.join(root, "samples")),
    "samples/ is missing; run `npm run package` then `npm run sample-report`.",
  );
  walk(path.join(root, "samples"));

  // Without a built package the generator cannot emit the embedded visual, so compare only
  // the files it was able to produce and flag the gap separately.
  const comparable = packageBuilt
    ? [...committed.keys()]
    : [...committed.keys()].filter((key) => !key.includes("/CustomVisuals/"));

  const missing = [...expected.keys()].filter((key) => !committed.has(key));
  ensure(missing.length === 0, `samples/ is missing generated file(s): ${missing.join(", ")}`);

  const unexpected = comparable.filter((key) => !expected.has(key));
  ensure(unexpected.length === 0, `samples/ contains unexpected file(s): ${unexpected.join(", ")}`);

  const drifted = comparable.filter((key) => normalize(committed.get(key)) !== normalize(expected.get(key)));
  ensure(
    drifted.length === 0,
    `samples/ is stale; re-run \`npm run package && npm run sample-report\`. Drifted: ${drifted.join(", ")}`,
  );

  const embeddedNote = packageBuilt
    ? "embedded visual verified against dist/"
    : "embedded visual NOT verified (dist/ has no package)";
  return `${comparable.length} of ${committed.size} files compared, ${embeddedNote}`;
});

await check("sample report binds the frozen GUID with declared roles and no external source", () => {
  const capabilities = readJson(path.join(root, "capabilities.json"));
  const roleNames = new Set(capabilities.dataRoles.map((role) => role.name));
  const pagesRoot = path.join(root, "samples", `${SAMPLE_SLUG}.Report`, "definition", "pages");
  const pageIds = readdirSync(pagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  ensure(pageIds.length === 2, `Expected the distribution and hints pages, found ${pageIds.length}.`);

  const pageByDisplayName = new Map(pageIds.map((pageId) => {
    const page = readJson(path.join(pagesRoot, pageId, "page.json"));
    return [page.displayName, pageId];
  }));
  const distributionPageId = pageByDisplayName.get(DISTRIBUTION_PAGE_NAME);
  const hintsPageId = pageByDisplayName.get(HINTS_PAGE_NAME);
  ensure(distributionPageId, `Missing "${DISTRIBUTION_PAGE_NAME}" page.`);
  ensure(hintsPageId, `Missing "${HINTS_PAGE_NAME}" page.`);

  const visualsRoot = path.join(pagesRoot, distributionPageId, "visuals");
  const visualIds = readdirSync(visualsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  ensure(visualIds.length === 1, `Expected exactly one distribution visual, found ${visualIds.length}.`);

  const visualPath = path.join(visualsRoot, visualIds[0], "visual.json");
  const visual = readJson(visualPath);
  ensure(
    visual.visual.visualType === FROZEN_GUID,
    `Sample report binds "${visual.visual.visualType}" instead of the frozen GUID.`,
  );

  const queryState = visual.visual.query.queryState;
  const stateKeys = Object.keys(queryState);
  stateKeys.forEach((key) => ensure(
    roleNames.has(key),
    `queryState key "${key}" is not a capabilities.json data role.`,
  ));
  ensure(
    stateKeys.join(",") === "Category,Sample,Value",
    `Sample queryState must bind Category, Sample, and Value; found ${stateKeys.join(", ")}.`,
  );
  ensure(
    queryState.Category.projections?.[0]?.field?.Column
      && queryState.Sample.projections?.[0]?.field?.Column,
    "Sample Category and Sample roles must project raw columns.",
  );
  const valueAggregation = queryState.Value.projections?.[0]?.field?.Aggregation;
  ensure(
    valueAggregation?.Function === 0
      && valueAggregation.Expression?.Column?.Property === "Value",
    "Sample Value role must use Sum(Measurements.Value), as required for a Measure role.",
  );

  const hintsVisualRoot = path.join(pagesRoot, hintsPageId, "visuals");
  const hintsVisualIds = readdirSync(hintsVisualRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  ensure(hintsVisualIds.length >= 4, `Expected at least four hints/tips text boxes, found ${hintsVisualIds.length}.`);
  const hintsText = hintsVisualIds
    .map((id) => readFileSync(path.join(hintsVisualRoot, id, "visual.json"), "utf8"))
    .join("\n");
  ensure(hintsText.includes('"visualType": "textbox"'), "Hints/tips page has no native text box visual.");
  [
    "Category, Sample, and Value",
    "raw, unsummarized numeric column",
    "one row per observation",
    "Things to avoid",
    "Avoid aggregating Value",
  ].forEach((token) => ensure(hintsText.includes(token), `Hints/tips page is missing "${token}".`));

  const report = readJson(path.join(root, "samples", `${SAMPLE_SLUG}.Report`, "definition", "report.json"));
  ensure(
    report.publicCustomVisuals === undefined,
    "report.json uses publicCustomVisuals, which resolves from AppSource and is not offline.",
  );
  ensure(
    report.resourcePackages?.some((entry) => entry.type === "CustomVisual" && entry.name === FROZEN_GUID),
    "report.json is missing the CustomVisual resource package that embeds the visual.",
  );

  const tmdlRoot = path.join(root, "samples", `${SAMPLE_SLUG}.SemanticModel`, "definition");
  const tmdl = readFileSync(path.join(tmdlRoot, "tables", "Measurements.tmdl"), "utf8");
  EXTERNAL_SOURCE_TOKENS.forEach((token) => ensure(
    !tmdl.includes(token),
    `Sample report semantic model references an external data source (${token}).`,
  ));
  ensure(
    !EXTERNAL_URL_PATTERN.test(tmdl),
    "Sample report semantic model contains a URL, so it is not fully offline.",
  );
  ensure(
    tmdl.includes("= calculated") && tmdl.includes("DATATABLE("),
    "Sample report semantic model is not a DAX calculated table.",
  );

  const everyTmdl = readdirSync(tmdlRoot, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tmdl"))
    .map((entry) => readFileSync(path.join(entry.parentPath ?? entry.path, entry.name), "utf8"))
    .join("\n");
  ensure(
    !/^\s*partition .+ = m$/m.test(everyTmdl),
    "Sample report semantic model still has a Power Query partition, which is a refreshable data source.",
  );
  ensure(
    !/^\s*expression /m.test(everyTmdl) && !/^\s*dataSource /m.test(everyTmdl),
    "Sample report semantic model declares a shared expression or data source.",
  );

  return `${stateKeys.join(", ")} bound to ${FROZEN_GUID}`;
});

/**
 * Where a resource package item's `path` is resolved from, per package type.
 *
 * Several candidate bases are tried for each type and *all* of them are reported when a
 * reference resolves against none, so a miss cannot be waved away as "the audit guessed
 * the wrong base directory". A path that resolves under no documented base does not exist
 * under any of them.
 */
const RESOURCE_PACKAGE_BASES = {
  CustomVisual: (pkg) => [
    `CustomVisuals/${pkg.name}/resources`,
    `CustomVisuals/${pkg.name}`,
  ],
  SharedResources: () => [
    "StaticResources/SharedResources",
    "SharedResources",
  ],
  RegisteredResources: () => [
    "StaticResources/RegisteredResources",
    "RegisteredResources",
  ],
};

/**
 * Resolves every internal reference the sample project declares against what is actually
 * on disk.
 *
 * This exists because JSON Schema cannot catch this class of defect. Schema validation
 * constrains *shape*: a `path` that points at a file which does not exist is perfectly
 * schema-valid, so a schema pass over a report that Desktop refuses to open returns green
 * and produces exactly the false assurance a check like this is supposed to remove. The
 * only way to know a declared reference is real is to resolve it.
 *
 * A resource package declaring `type: SharedResources` is not a by-name reference to one
 * of Desktop's built-in themes - that is what `themeCollection.baseTheme` is for, and it
 * is legitimate. A resource package asserts the item ships *as a file inside the report*,
 * so Desktop resolves the path, and a path to nothing is a broken report.
 */
await check("sample report has no dangling internal references", () => {
  const samplesRoot = path.join(root, "samples");
  const reportFolder = `${SAMPLE_SLUG}.Report`;
  const references = [];

  /**
   * @param from the file that declares the reference
   * @param kind "file" or "directory"
   * @param candidates repo-relative POSIX paths, any one of which satisfies the reference
   */
  const declare = (from, description, kind, candidates) => {
    references.push({ from, description, kind, candidates });
  };

  // 1. The .pbip names its artifact folders.
  const pbipPath = path.join(samplesRoot, `${SAMPLE_SLUG}.pbip`);
  const pbip = readJson(pbipPath);
  for (const artifact of pbip.artifacts ?? []) {
    for (const [artifactKind, artifactValue] of Object.entries(artifact)) {
      if (artifactValue?.path) {
        declare(`${SAMPLE_SLUG}.pbip`, `${artifactKind} artifact "${artifactValue.path}"`, "directory", [
          `samples/${artifactValue.path}`,
        ]);
      }
    }
  }

  // 2. The .pbir points the report at its semantic model.
  const pbirPath = path.join(samplesRoot, reportFolder, "definition.pbir");
  const pbir = readJson(pbirPath);
  const datasetPath = pbir.datasetReference?.byPath?.path;
  if (datasetPath) {
    declare(`${reportFolder}/definition.pbir`, `dataset "${datasetPath}"`, "directory", [
      path.posix.normalize(`samples/${reportFolder}/${datasetPath}`),
    ]);
  }

  // 3. Every resource package item claims to ship as a file inside the report.
  const reportJsonPath = path.join(samplesRoot, reportFolder, "definition", "report.json");
  const report = readJson(reportJsonPath);
  for (const pkg of report.resourcePackages ?? []) {
    const bases = RESOURCE_PACKAGE_BASES[pkg.type];
    ensure(
      bases,
      `report.json declares resource package type "${pkg.type}", which this audit cannot `
      + "resolve. Add its base directory to RESOURCE_PACKAGE_BASES rather than skipping it.",
    );
    for (const item of pkg.items ?? []) {
      declare(
        `${reportFolder}/definition/report.json`,
        `${pkg.type} package "${pkg.name}" item "${item.path}"`,
        "file",
        bases(pkg).map((base) => `samples/${reportFolder}/${base}/${item.path}`),
      );
    }
  }

  // 4. pages.json names page folders.
  const pagesJsonPath = path.join(samplesRoot, reportFolder, "definition", "pages", "pages.json");
  const pages = readJson(pagesJsonPath);
  const pageBase = `samples/${reportFolder}/definition/pages`;
  for (const pageName of pages.pageOrder ?? []) {
    declare("definition/pages/pages.json", `pageOrder entry "${pageName}"`, "directory", [`${pageBase}/${pageName}`]);
  }
  if (pages.activePageName) {
    declare("definition/pages/pages.json", `activePageName "${pages.activePageName}"`, "directory", [
      `${pageBase}/${pages.activePageName}`,
    ]);
  }

  // 5. Each page and visual folder must carry the name its own definition claims, and each
  //    visual must reference a visual type the report actually embeds.
  const declaredCustomVisuals = new Set(
    (report.resourcePackages ?? [])
      .filter((pkg) => pkg.type === "CustomVisual")
      .map((pkg) => pkg.name),
  );
  const identityMismatches = [];
  const pageDirectories = readdirSync(path.join(samplesRoot, reportFolder, "definition", "pages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const pageDirectory of pageDirectories) {
    const pageJson = readJson(path.join(samplesRoot, reportFolder, "definition", "pages", pageDirectory, "page.json"));
    if (pageJson.name !== pageDirectory) {
      identityMismatches.push(`page folder "${pageDirectory}" declares name "${pageJson.name}"`);
    }
    const visualsRoot = path.join(samplesRoot, reportFolder, "definition", "pages", pageDirectory, "visuals");
    if (!existsSync(visualsRoot)) {
      continue;
    }
    for (const visualEntry of readdirSync(visualsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      declare(
        `definition/pages/${pageDirectory}`,
        `visual folder "${visualEntry.name}"`,
        "file",
        [`${pageBase}/${pageDirectory}/visuals/${visualEntry.name}/visual.json`],
      );
      const visualJson = readJson(path.join(visualsRoot, visualEntry.name, "visual.json"));
      if (visualJson.name !== visualEntry.name) {
        identityMismatches.push(`visual folder "${visualEntry.name}" declares name "${visualJson.name}"`);
      }
      const visualType = visualJson.visual?.visualType;
      // A custom visual type has to be embedded, or the report silently renders nothing
      // offline. Built-in types are not resolvable against disk and are left alone.
      if (visualType && /^[a-zA-Z]+[A-Z0-9]{16,}$/.test(visualType) && !declaredCustomVisuals.has(visualType)) {
        identityMismatches.push(
          `visual "${visualEntry.name}" uses custom visual type "${visualType}", `
          + "which no CustomVisual resource package embeds",
        );
      }
    }
  }

  // 6. The embedded visual's own manifest names its resource files.
  for (const packageName of declaredCustomVisuals) {
    const manifestRelative = `samples/${reportFolder}/CustomVisuals/${packageName}/package.json`;
    const manifestPath = path.join(root, manifestRelative);
    if (!existsSync(manifestPath)) {
      declare(`${reportFolder}/definition/report.json`, `CustomVisual package manifest for "${packageName}"`, "file", [manifestRelative]);
      continue;
    }
    const manifest = readJson(manifestPath);
    for (const resource of manifest.resources ?? []) {
      if (resource.file) {
        declare(
          `CustomVisuals/${packageName}/package.json`,
          `resource "${resource.file}"`,
          "file",
          [`samples/${reportFolder}/CustomVisuals/${packageName}/${resource.file}`],
        );
      }
    }
  }

  // 7. model.tmdl references its table definitions by name.
  const semanticModelFolder = `${SAMPLE_SLUG}.SemanticModel`;
  const modelTmdlPath = path.join(samplesRoot, semanticModelFolder, "definition", "model.tmdl");
  const modelTmdl = readFileSync(modelTmdlPath, "utf8");
  for (const match of modelTmdl.matchAll(/^\s*ref\s+table\s+(.+?)\s*$/gm)) {
    const tableName = match[1].replace(/^'(.*)'$/, "$1");
    declare(`${semanticModelFolder}/definition/model.tmdl`, `ref table ${tableName}`, "file", [
      `samples/${semanticModelFolder}/definition/tables/${tableName}.tmdl`,
    ]);
  }

  const resolves = (reference) => reference.candidates.some((candidate) => {
    const absolute = path.join(root, candidate);
    if (!existsSync(absolute)) {
      return false;
    }
    const stats = statSync(absolute);
    return reference.kind === "directory" ? stats.isDirectory() : stats.isFile();
  });

  const dangling = references.filter((reference) => !resolves(reference));
  ensure(
    dangling.length === 0,
    `Sample report declares ${dangling.length} reference(s) that resolve to nothing on disk. `
    + "Power BI Desktop resolves these paths when it opens the project, so a dangling one "
    + "means the sample does not open:\n"
    + dangling
      .map((reference) => `      ${reference.from}: ${reference.description}\n`
        + `        tried: ${reference.candidates.join(", ")}`)
      .join("\n"),
  );

  ensure(identityMismatches.length === 0, `Sample report has inconsistent names: ${identityMismatches.join("; ")}`);

  return `${references.length} references resolve`;
});

/**
 * The indentation the expression block under `source =` must start at.
 *
 * TMDL takes the *first* expression line's indentation as the baseline for the whole
 * block, so this depth changes how everything beneath it is parsed - it is load-bearing,
 * not cosmetic. Four tabs is what the sibling sample that is known to open in Power BI
 * Desktop uses; this project shipped three, and was the only one of six that did.
 */
const EXPRESSION_BASELINE_TABS = 4;

const leadingTabs = (line) => line.length - line.replace(/^\t+/, "").length;

/**
 * Pins the two TMDL shape details this project diverged on.
 *
 * Stated carefully: unlike a dangling reference, which resolves to nothing and is
 * therefore provably broken, neither of these can be shown to be causal without opening
 * the sample in Power BI Desktop. They are *departures from the only configuration known
 * to open*, which is reason enough to hold them and not reason enough to call them proven
 * defects.
 *
 * This is checked against the generator's output rather than left to the drift check,
 * because the generator is the source of truth: drift compares the committed sample to
 * whatever the generator currently emits, so editing the generator moves both sides
 * together and drift stays silent.
 */
await check("sample semantic model keeps the TMDL shape known to open in Desktop", () => {
  const tablesRoot = path.join(root, "samples", `${SAMPLE_SLUG}.SemanticModel`, "definition", "tables");
  const tableFiles = readdirSync(tablesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tmdl"))
    .map((entry) => entry.name);
  ensure(tableFiles.length > 0, "Sample semantic model declares no table files.");

  const problems = [];
  let expressionBlocks = 0;
  let calculatedColumns = 0;

  for (const fileName of tableFiles) {
    const lines = readFileSync(path.join(tablesRoot, fileName), "utf8").split(/\r?\n/);
    const isCalculatedTable = lines.some((line) => /^\s*partition .+ = calculated\s*$/.test(line));
    if (!isCalculatedTable) {
      continue;
    }

    // Explicit column types on a calculated table restate what the DATATABLE declaration
    // in the partition already fixes. They can only agree redundantly or disagree.
    let currentColumn;
    for (const line of lines) {
      const columnMatch = /^\t*column\s+(.+?)\s*$/.exec(line);
      if (columnMatch) {
        currentColumn = columnMatch[1];
        calculatedColumns += 1;
        continue;
      }
      if (/^\t*partition\s/.test(line)) {
        currentColumn = undefined;
        continue;
      }
      const typeMatch = /^\t*dataType:\s*(\S+)/.exec(line);
      if (typeMatch && currentColumn) {
        problems.push(
          `${fileName}: column "${currentColumn}" declares dataType ${typeMatch[1]} on a `
          + "calculated table, where the DATATABLE declaration already fixes the type",
        );
      }
    }

    // The expression block baseline.
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\t*source\s*=\s*$/.test(lines[index])) {
        continue;
      }
      const sourceTabs = leadingTabs(lines[index]);
      const firstBodyIndex = lines.findIndex((line, at) => at > index && line.trim().length > 0);
      ensure(firstBodyIndex !== -1, `${fileName}: "source =" has no expression body.`);
      expressionBlocks += 1;

      const baseline = leadingTabs(lines[firstBodyIndex]);
      if (baseline !== EXPRESSION_BASELINE_TABS) {
        problems.push(
          `${fileName}: expression block starts at ${baseline} tab(s), expected `
          + `${EXPRESSION_BASELINE_TABS}. TMDL uses the first line's indentation as the `
          + "baseline for the whole block, so this changes how all of it parses",
        );
      }
      if (baseline <= sourceTabs) {
        problems.push(
          `${fileName}: expression block at ${baseline} tab(s) is not indented deeper than `
          + `its "source =" at ${sourceTabs} tab(s)`,
        );
      }

      // Every remaining line of the block must sit at or below the baseline, or the block
      // has been re-indented inconsistently.
      for (let body = firstBodyIndex; body < lines.length; body += 1) {
        const line = lines[body];
        if (line.trim().length === 0) {
          continue;
        }
        if (leadingTabs(line) < baseline) {
          break;
        }
      }
    }
  }

  ensure(
    problems.length === 0,
    "Sample semantic model departs from the TMDL shape known to open in Power BI Desktop:\n"
    + problems.map((problem) => `      ${problem}`).join("\n"),
  );

  return `${expressionBlocks} expression block(s) at ${EXPRESSION_BASELINE_TABS} tabs, `
    + `${calculatedColumns} calculated column(s) with no explicit dataType`;
});

await check("sample report embeds the current build of the visual", async () => {
  const reportFolder = `${SAMPLE_SLUG}.Report`;
  const embeddedRoot = path.join(root, "samples", reportFolder, "CustomVisuals", FROZEN_GUID);
  if (!existsSync(embeddedRoot)) {
    // The generator omits the embedded visual when dist/ has no package. That is already
    // reported by the drift check; do not invent a second failure for it.
    return "no embedded visual to compare (dist/ has no package)";
  }

  const artifactPath = path.join(root, "dist", `${FROZEN_GUID}.${visual.version}.pbiviz`);
  ensure(
    existsSync(artifactPath),
    `samples/ embeds the visual but dist/${FROZEN_GUID}.${visual.version}.pbiviz is missing, `
    + "so the embedded copy cannot be shown to be current. Run `npm run package`.",
  );

  // Compared byte-for-byte against the archive rather than trusted: a stale embedded copy
  // ships a different visual than the one under test, and nothing else would notice.
  const archive = await JSZip.loadAsync(readFileSync(artifactPath));
  const entries = ["package.json", `resources/${FROZEN_GUID}.pbiviz.json`];

  const stale = [];
  for (const entry of entries) {
    const embeddedPath = path.join(embeddedRoot, entry);
    ensure(existsSync(embeddedPath), `Embedded visual is missing ${entry}.`);
    const archived = archive.file(entry);
    ensure(archived, `Packaged visual has no ${entry} entry.`);
    const fromArchive = Buffer.from(await archived.async("uint8array"));
    if (!readFileSync(embeddedPath).equals(fromArchive)) {
      stale.push(entry);
    }
  }

  ensure(
    stale.length === 0,
    "Embedded visual is stale; re-run `npm run package && npm run sample-report`. "
    + `Differs from dist/: ${stale.join(", ")}`,
  );

  return `${entries.length} embedded file(s) byte-identical to dist/`;
});

const sampleReportPbix = path.join(root, "samples", `${SAMPLE_SLUG}.pbix`);
await check("Desktop-authored sample PBIX is present", () => {
  const bytes = requireNonEmptyFile(sampleReportPbix, 1024);
  return `${bytes} bytes`;
});

console.log("Atlyn Distribution - AppSource submission asset audit");
console.log(checks.join("\n"));

if (failures.length > 0) {
  console.error(`\n${failures.length} submission asset check(s) failed:`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`\nAll ${checks.length} submission asset checks passed.`);
