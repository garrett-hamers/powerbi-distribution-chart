import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { hasPngSignature, readPngHeader } from "./png-utils.mjs";
import { buildSampleCsv } from "./write-sample-dataset.mjs";
import { SAMPLE_SLUG, buildSampleReportFiles } from "./build-sample-report.mjs";

/**
 * Deterministic gate for the Microsoft AppSource / Partner Center submission assets.
 *
 * Every rule here maps to a published Partner Center requirement for Power BI visuals:
 * https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store
 *
 * The one requirement this script cannot enforce is the sample .pbix report, which only
 * Power BI Desktop can author. Its status is reported explicitly instead of being faked.
 */

const LOGO_SIZE = 300;
const ICON_SIZE = 20;
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const MIN_SCREENSHOTS = 1;
const MAX_SCREENSHOTS = 5;
const FROZEN_GUID = "atlynDistributionA1B2C3D4E5F6G7H8I9J0";
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
        committed.set(relative(absolute), readFileSync(absolute, "utf8"));
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
  ensure(pageIds.length === 1, `Expected exactly one report page, found ${pageIds.length}.`);

  const visualsRoot = path.join(pagesRoot, pageIds[0], "visuals");
  const visualIds = readdirSync(visualsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  ensure(visualIds.length === 1, `Expected exactly one visual, found ${visualIds.length}.`);

  const visualPath = path.join(visualsRoot, visualIds[0], "visual.json");
  const visualText = readFileSync(visualPath, "utf8");
  const visual = JSON.parse(visualText);
  ensure(
    visual.visual.visualType === FROZEN_GUID,
    `Sample report binds "${visual.visual.visualType}" instead of the frozen GUID.`,
  );

  const stateKeys = Object.keys(visual.visual.query.queryState);
  stateKeys.forEach((key) => ensure(
    roleNames.has(key),
    `queryState key "${key}" is not a capabilities.json data role.`,
  ));
  ensure(
    !visualText.includes("Aggregation"),
    "Sample report aggregates a field; Atlyn Distribution requires raw, unsummarized observations.",
  );

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

const sampleReportPbix = path.join(root, "samples", `${SAMPLE_SLUG}.pbix`);
const sampleReportStatus = existsSync(sampleReportPbix)
  ? `present (samples/${SAMPLE_SLUG}.pbix)`
  : "MISSING";

console.log("Atlyn Distribution - AppSource submission asset audit");
console.log(checks.join("\n"));
console.log("");
console.log(`  INFO  Sample .pbix report: ${sampleReportStatus}`);
if (sampleReportStatus === "MISSING") {
  console.log(`        The offline project is committed at samples/${SAMPLE_SLUG}.pbip and is validated above.`);
  console.log("        A .pbix cannot be produced headlessly - its DataModel part is a binary Analysis");
  console.log("        Services backup image. Open the PBIP in Power BI Desktop and confirm the visual");
  console.log("        renders with data; if any table is empty, run Home > Refresh > Schema and data");
  console.log("        first. Only then File > Save As .pbix - saving while the tables are empty ships");
  console.log("        a .pbix with no data. See docs/partner-center-submission.md section 4.1.");
}

if (failures.length > 0) {
  console.error(`\n${failures.length} submission asset check(s) failed:`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`\nAll ${checks.length} submission asset checks passed.`);
