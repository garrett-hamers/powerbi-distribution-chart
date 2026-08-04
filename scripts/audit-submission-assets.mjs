import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { hasPngSignature, readPngHeader } from "./png-utils.mjs";
import { buildSampleCsv } from "./write-sample-dataset.mjs";

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
  [FROZEN_GUID, SUPPORT_URL, PRIVACY_POLICY_URL, "EULA.md", "assets/logo-300x300.png"].forEach((token) => {
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

const sampleReportPath = path.join(root, "assets", "sample-report");
let sampleReportStatus = "MISSING";
try {
  const reports = readdirSync(sampleReportPath).filter((name) => name.toLowerCase().endsWith(".pbix"));
  sampleReportStatus = reports.length > 0 ? `present (${reports.join(", ")})` : "MISSING";
} catch {
  sampleReportStatus = "MISSING";
}

console.log("Atlyn Distribution - AppSource submission asset audit");
console.log(checks.join("\n"));
console.log("");
console.log(`  INFO  Sample .pbix report: ${sampleReportStatus}`);
if (sampleReportStatus === "MISSING") {
  console.log("        Microsoft requires a sample .pbix, which only Power BI Desktop can author.");
  console.log("        Build it from assets/sample-data/atlyn-distribution-sample.csv using the recipe in");
  console.log("        docs/partner-center-submission.md. This audit cannot generate or verify it.");
}

if (failures.length > 0) {
  console.error(`\n${failures.length} submission asset check(s) failed:`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`\nAll ${checks.length} submission asset checks passed.`);
