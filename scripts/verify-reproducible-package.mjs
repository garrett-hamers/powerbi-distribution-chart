import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "dist");
const temporaryRoot = path.join(root, ".tmp", "reproducibility");
const run = () => {
  const npmCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const npmArguments = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run package"]
    : ["run", "package"];
  const result = spawnSync(npmCommand, npmArguments, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const findArtifact = async () => {
  const artifacts = (await readdir(outputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pbiviz"));
  if (artifacts.length !== 1) {
    throw new Error(`Expected exactly one PBIVIZ artifact, found ${artifacts.length}.`);
  }
  return path.join(outputDirectory, artifacts[0].name);
};

const hash = async (filePath) => {
  const contents = await readFile(filePath);
  return {
    bytes: (await stat(filePath)).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
};

await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await readdir(root, { withFileTypes: true }).then((entries) => Promise.all(
  entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pbiviz"))
    .map((entry) => rm(path.join(root, entry.name), { force: true })),
));
await readdir(outputDirectory, { withFileTypes: true }).then((entries) => Promise.all(
 entries
     .filter((entry) => entry.isFile() && entry.name.endsWith(".pbiviz"))
     .map((entry) => rm(path.join(outputDirectory, entry.name), { force: true })),
));

run();
const firstArtifactPath = await findArtifact();
const artifactName = path.basename(firstArtifactPath);
const firstPath = path.join(temporaryRoot, artifactName);
await copyFile(firstArtifactPath, firstPath);
const first = await hash(firstPath);

run();
const secondArtifactPath = await findArtifact();
const secondArtifactName = path.basename(secondArtifactPath);
if (secondArtifactName !== artifactName) {
  throw new Error(`PBIVIZ filename changed between runs: ${artifactName} -> ${secondArtifactName}`);
}
const second = await hash(secondArtifactPath);
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error(`PBIVIZ package is not reproducible: ${JSON.stringify(first)} != ${JSON.stringify(second)}`);
}

console.log(`${artifactName}: ${second.bytes} bytes, sha256=${second.sha256}`);
