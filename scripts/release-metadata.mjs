import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const pbivizPath = path.join(root, "pbiviz.json");
const logoPath = path.join(root, "assets", "logo-300x300.png");

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

const parsePng300 = (filePath) => {
  const buffer = readFileSync(filePath);
  ensure(buffer.length >= 24, `PNG is unexpectedly short: ${filePath}`);
  ensure(
    PNG_SIGNATURE.every((value, index) => buffer[index] === value),
    `PNG signature is invalid: ${filePath}`,
  );
  ensure(buffer.subarray(12, 16).toString("ascii") === "IHDR", `PNG is missing IHDR: ${filePath}`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  ensure(width === 300 && height === 300, `Expected 300x300 PNG, got ${width}x${height}: ${filePath}`);
  return { width, height, bytes: buffer.length, sha256: hash(buffer) };
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
const logo = parsePng300(logoPath);
const artifact = readFileSync(artifactPath);

const metadata = {
  schemaVersion: 1,
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
  assets: {
    icon: {
      path: pbiviz.assets.icon,
      bytes: iconBuffer.length,
      sha256: hash(iconBuffer),
    },
    partnerCenterLogo300: {
      path: path.relative(root, logoPath).replaceAll("\\", "/"),
      width: logo.width,
      height: logo.height,
      bytes: logo.bytes,
      sha256: logo.sha256,
    },
  },
  toolchain: {
    node: process.version,
    npm: npmResult.stdout.trim(),
    powerbiVisualsTools: packageJson.devDependencies["powerbi-visuals-tools"],
  },
};

writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath).replaceAll("\\", "/")}`);
