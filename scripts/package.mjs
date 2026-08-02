import { mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { normalizePbiviz } from "./normalize-pbiviz.mjs";

const root = process.cwd();
const pbivizCommand = process.platform === "win32" ? "pbiviz.cmd" : "pbiviz";
const packageArguments = ["package", "--no-stats", ...process.argv.slice(2)];
const manifest = JSON.parse(readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const outputDirectory = path.join(root, "dist");
const expectedArtifactName = `${manifest.visual.guid}.${manifest.visual.version}.pbiviz`;

mkdirSync(outputDirectory, { recursive: true });
for (const directory of [root, outputDirectory]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".pbiviz")) {
      unlinkSync(path.join(directory, entry.name));
    }
  }
}

const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : pbivizCommand;
const commandArguments = process.platform === "win32"
  ? ["/d", "/s", "/c", [pbivizCommand, ...packageArguments].join(" ")]
  : packageArguments;
const result = spawnSync(command, commandArguments, {
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

const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".pbiviz"))
  .map((entry) => path.join(outputDirectory, entry.name));

if (artifacts.length !== 1) {
  throw new Error(`Expected exactly one PBIVIZ artifact, found ${artifacts.length}.`);
}
if (path.basename(artifacts[0]) !== expectedArtifactName) {
  throw new Error(`Expected PBIVIZ artifact ${expectedArtifactName}, found ${path.basename(artifacts[0])}.`);
}

await normalizePbiviz(artifacts[0]);
