import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hasPngSignature, readPngHeader } from "./png-utils.mjs";

const LOGO_SIZE = 300;
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const PRIVACY_POLICY_URL = "https://atlyn.io/legal/privacy";
const TERMS_URL = "https://atlyn.io/legal/terms";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const pbivizPath = path.join(root, "pbiviz.json");
const logoPath = path.join(root, "assets", "logo-300x300.png");
const screenshotDirectory = path.join(root, "assets", "screenshots");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const pbiviz = JSON.parse(readFileSync(pbivizPath, "utf8"));
const expectedArtifactName = `${pbiviz.visual.guid}.${pbiviz.visual.version}.pbiviz`;
const distDirectory = path.join(root, "dist");
const artifactPath = path.join(distDirectory, expectedArtifactName);
const distManifestPath = path.join(distDirectory, "package.json");
const outputPath = path.join(distDirectory, "release-metadata.json");

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

const parsePng = (filePath, expectedWidth, expectedHeight, maximumBytes) => {
  const buffer = readFileSync(filePath);
  ensure(hasPngSignature(buffer), `PNG signature is invalid: ${filePath}`);
  const { width, height } = readPngHeader(buffer);
  ensure(
    width === expectedWidth && height === expectedHeight,
    `Expected ${expectedWidth}x${expectedHeight} PNG, got ${width}x${height}: ${filePath}`,
  );
  ensure(
    maximumBytes === undefined || buffer.length <= maximumBytes,
    `${filePath} is ${buffer.length} bytes, over the ${maximumBytes} byte limit.`,
  );
  return {
    path: path.relative(root, filePath).replaceAll("\\", "/"),
    width,
    height,
    bytes: buffer.length,
    sha256: hash(buffer),
  };
};

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

const gitResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  shell: false,
  windowsHide: process.platform === "win32",
});
if (gitResult.error) {
  throw gitResult.error;
}
ensure(gitResult.status === 0, `Unable to read git commit: ${gitResult.stderr || gitResult.stdout}`);

const npmCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const npmArguments = process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd --version"] : ["--version"];
const npmResult = spawnSync(npmCommand, npmArguments, {
  cwd: root,
  encoding: "utf8",
  shell: false,
  windowsHide: process.platform === "win32",
});
if (npmResult.error) {
  throw npmResult.error;
}
ensure(npmResult.status === 0, `Unable to read npm version: ${npmResult.stderr || npmResult.stdout}`);

const distManifest = readJson(distManifestPath);
const iconPath = path.join(root, pbiviz.assets.icon);
const iconBuffer = readFileSync(iconPath);
const logo = parsePng(logoPath, LOGO_SIZE, LOGO_SIZE);
const screenshots = readdirSync(screenshotDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
  .map((entry) => entry.name)
  .sort()
  .map((name) => parsePng(
    path.join(screenshotDirectory, name),
    SCREENSHOT_WIDTH,
    SCREENSHOT_HEIGHT,
    MAX_SCREENSHOT_BYTES,
  ));
ensure(
  screenshots.length >= 1 && screenshots.length <= 5,
  `AppSource accepts 1-5 listing screenshots; found ${screenshots.length}.`,
);
const artifact = readFileSync(artifactPath);

const metadata = {
  schemaVersion: 2,
  sourceCommit: gitResult.stdout.trim(),
  visual: {
    guid: pbiviz.visual.guid,
    version: pbiviz.visual.version,
    displayName: pbiviz.visual.displayName,
  },
  package: {
    fileName: expectedArtifactName,
    bytes: artifact.length,
    sha256: hash(artifact),
    bundleVersion: distManifest.version,
  },
  submission: {
    appSourceListing: "Free",
    monetization: "Atlyn storefront subscription at https://atlyn.io (separate from AppSource)",
    supportUrl: pbiviz.visual.supportUrl,
    privacyPolicyUrl: PRIVACY_POLICY_URL,
    termsUrl: TERMS_URL,
    authorName: pbiviz.author.name,
    authorEmail: pbiviz.author.email,
    eula: "EULA.md",
    dossier: "docs/partner-center-submission.md",
    sampleDataset: "assets/sample-data/atlyn-distribution-sample.csv",
    sampleReportProject: "samples/AtlynSample.pbip",
  },
  assets: {
    icon: {
      path: pbiviz.assets.icon,
      bytes: iconBuffer.length,
      sha256: hash(iconBuffer),
    },
    partnerCenterLogo300: logo,
    listingScreenshots: screenshots,
  },
  toolchain: {
    node: process.version,
    npm: npmResult.stdout.trim(),
    powerbiVisualsTools: packageJson.devDependencies["powerbi-visuals-tools"],
  },
};

writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath).replaceAll("\\", "/")}`);
