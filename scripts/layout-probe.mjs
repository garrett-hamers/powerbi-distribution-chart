import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { findBrowser, launchBrowser, openPage } from "./browser.mjs";

/**
 * Layout probe for the Atlyn Distribution visual.
 *
 * A Power BI custom visual is rendered inside a host tile with `overflow: hidden`.
 * Anything the visual pushes outside that tile is silently clipped: it does not scroll,
 * and nothing tells the report author that content is missing. That failure mode is
 * invisible to unit tests - asserting a stylesheet is non-empty passes, and asserting
 * CSS declarations passes - and it is invisible to JSDOM, which has no layout engine and
 * returns zero for every rectangle. A geometry assertion written against JSDOM is not
 * weak, it is vacuous: it can never fail.
 *
 * So this runs the *packaged* `.pbiviz` bundle - the artifact the host actually loads,
 * not the source tree - in real headless Chromium, renders it across a matrix of tile
 * sizes, feature states and writing directions, and measures every element's real
 * `getBoundingClientRect()` against the visual root's clipped box.
 *
 * Usage:
 *   node scripts/layout-probe.mjs [--skip-package] [--report-only] [--filter <substring>]
 *                                 [--json <path>] [--quiet]
 */

const root = process.cwd();
const toolsDirectory = path.join(root, "tools");
const layoutDirectory = path.join(toolsDirectory, "layout");
const temporaryDirectory = path.join(root, ".tmp", "layout-probe");

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const flagValue = (flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const skipPackage = hasFlag("--skip-package");
const reportOnly = hasFlag("--report-only");
const quiet = hasFlag("--quiet");
const filter = flagValue("--filter");
const jsonPath = flagValue("--json");

const { buildCases } = await import(pathToFileURL(path.join(layoutDirectory, "cases.mjs")).href);

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const log = (message) => {
  if (!quiet) {
    console.log(message);
  }
};

const runNpm = (script) => {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArguments = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm.cmd run ${script}`]
    : ["run", script];
  const result = spawnSync(command, commandArguments, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  ensure(result.status === 0, `npm run ${script} failed with exit code ${result.status}.`);
};

/**
 * Pulls the JavaScript the host would actually execute out of the packaged artifact.
 * Probing the source tree instead would let a packaging step reintroduce a defect the
 * probe just cleared.
 */
const extractBundle = async () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "pbiviz.json"), "utf8"));
  const artifactName = `${manifest.visual.guid}.${manifest.visual.version}.pbiviz`;
  const artifactPath = path.join(root, "dist", artifactName);
  ensure(
    existsSync(artifactPath),
    `Missing packaged visual at dist/${artifactName}. Run \`npm run package\` first.`,
  );

  const artifactBytes = readFileSync(artifactPath);
  const archive = await JSZip.loadAsync(artifactBytes);
  const resourceName = `resources/${manifest.visual.guid}.pbiviz.json`;
  const resource = archive.file(resourceName);
  ensure(resource, `Packaged visual is missing ${resourceName}.`);

  const packaged = JSON.parse(await resource.async("string"));
  const bundle = packaged?.content?.js;
  ensure(typeof bundle === "string" && bundle.length > 0, "Packaged visual contains no JavaScript bundle.");

  mkdirSync(temporaryDirectory, { recursive: true });
  const bundlePath = path.join(temporaryDirectory, "visual.js");
  writeFileSync(bundlePath, bundle, "utf8");

  return {
    artifactName,
    bundlePath,
    bundleBytes: Buffer.byteLength(bundle),
    artifactSize: artifactBytes.length,
    artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
  };
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const startServer = (bundlePath) => new Promise((resolve) => {
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;

    let filePath;
    if (requestPath === "/visual.js") {
      filePath = bundlePath;
    } else {
      // Everything else is served out of tools/, with a traversal guard.
      const candidate = path.join(toolsDirectory, path.normalize(requestPath).replace(/^([/\\])+/, ""));
      const relative = path.relative(toolsDirectory, candidate);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        filePath = candidate;
      }
    }

    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(filePath));
  });

  server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
});

const READY_EXPRESSION = `(() => ({
  ready: document.documentElement.dataset.probeReady === "true",
  error: document.documentElement.dataset.probeError,
}))()`;

/**
 * Elements allowed to sit behind the "clipped to zero by clip-path" exemption.
 *
 * The exemption exists for the screen-reader-only idiom, which is deliberately invisible
 * rather than accidentally lost - and this visual needs it, because `overflow` is inert
 * on a `display: table` box, so the accessible summary leans on `clip-path` to hide.
 * Pinning the list stops the exemption from quietly growing into a place where real
 * defects go to hide.
 */
const SCREEN_READER_ONLY = ["h2.atlyn-title", "table.atlyn-summary"];

/**
 * The gate.
 *
 * `overflow` is the generic check: any painted element whose box leaves the visual
 * root, excluding descendants of real scroll containers and anything deliberately
 * hidden. `dataLoss` is the "degrade chrome, never data" half: the box plots, their
 * category labels and the accessible summary table have to survive at every tile size,
 * whatever else is dropped.
 */
function evaluateCase(result) {
  const failures = [];

  if (result.overflow.overflowCount > 0) {
    const worst = result.overflow.overflows[0];
    failures.push(
      `${result.overflow.overflowCount} element(s) escape the visual root, worst `
      + `${worst.escape}px (${worst.selector}${worst.text ? ` "${worst.text}"` : ""})`,
    );
  }

  // An absolutely positioned child of a static root resolves against the initial
  // containing block and leaves the visual altogether.
  if (result.overflow.absolutelyPositioned > 0 && result.overflow.rootPosition === "static") {
    failures.push(
      `the visual root is position: static while holding ${result.overflow.absolutelyPositioned} `
      + "absolutely positioned descendant(s), which resolve against the initial containing block",
    );
  }

  const unexpected = result.overflow.clipPathRoots.filter((selector) => !SCREEN_READER_ONLY.includes(selector));
  if (unexpected.length > 0) {
    failures.push(
      `clip-path exemption claimed by unexpected element(s): ${unexpected.join(", ")}. `
      + `Only ${SCREEN_READER_ONLY.join(" and ")} are screen-reader-only.`,
    );
  }

  const { boxes, categories, categoryLabels } = result.data;
  if (boxes.total > 0 && boxes.invisible > 0) {
    failures.push(`${boxes.invisible}/${boxes.total} box plot(s) render entirely outside the tile`);
  }
  if (categories.total > 0 && categories.invisible > 0) {
    failures.push(`${categories.invisible}/${categories.total} distribution group(s) render entirely outside the tile`);
  }
  if (categoryLabels.total > 0 && categoryLabels.invisible > 0) {
    failures.push(`${categoryLabels.invisible}/${categoryLabels.total} category label(s) render entirely outside the tile`);
  }
  // The accessible summary is data, not chrome: it survives every tile size.
  if (result.data.boxes.total > 0 && result.data.summaryRows === 0) {
    failures.push("the accessible summary table lost every row");
  }

  return failures;
}

if (!skipPackage) {
  runNpm("package");
}

const browserPath = findBrowser();
const bundle = await extractBundle();
const { server, port } = await startServer(bundle.bundlePath);
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), "atlyn-layout-"));

const allCases = buildCases();
const cases = filter ? allCases.filter((entry) => entry.id.includes(filter)) : allCases;
ensure(cases.length > 0, `No probe cases matched --filter ${filter}.`);

log(`Browser:  ${browserPath}`);
log(`Artifact: ${bundle.artifactName} (${bundle.artifactSize} bytes, sha256=${bundle.artifactSha256})`);
log(`Bundle:   ${bundle.bundleBytes} bytes of packaged JavaScript`);
log(`Probe:    http://127.0.0.1:${port}/layout/probe.html`);
log(`Cases:    ${cases.length}${filter ? ` (filtered by "${filter}")` : ""}`);
log("");

const browser = await launchBrowser(browserPath, profileDirectory, ["--window-size=1600,900"]);
const results = [];
let failed = 0;

try {
  const page = await openPage(browser, {
    url: `http://127.0.0.1:${port}/layout/probe.html`,
    width: 1600,
    height: 900,
  });

  try {
    await page.waitForReady(READY_EXPRESSION);

    for (const probeCase of cases) {
      const response = await page.evaluate(
        `window.__atlynProbe.run(${JSON.stringify(probeCase)})`,
      );
      ensure(response, `Probe case ${probeCase.id} returned nothing.`);
      if (!response.ok) {
        throw new Error(`Probe case ${probeCase.id} threw:\n${response.error}`);
      }

      const result = response.result;
      const failures = evaluateCase(result);
      results.push({ ...probeCase, result, failures });

      const status = failures.length === 0 ? "PASS" : "FAIL";
      if (failures.length > 0) {
        failed += 1;
      }

      const summary = `${result.overflow.overflowCount} overflow, max ${result.overflow.maxEscape}px`;
      log(`  ${status}  ${probeCase.id.padEnd(46)}  ${summary}`);
      for (const failure of failures) {
        log(`         - ${failure}`);
      }
      if (failures.length > 0) {
        for (const overflow of result.overflow.overflows.slice(0, 6)) {
          log(
            `           ${overflow.selector} escape=${overflow.escape}px `
            + `(l${overflow.left} t${overflow.top} r${overflow.right} b${overflow.bottom}) `
            + `rect=${overflow.rect.width}x${overflow.rect.height}@${overflow.rect.x},${overflow.rect.y}`
            + `${overflow.text ? ` "${overflow.text.slice(0, 40)}"` : ""}`,
          );
        }
      }
    }
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  try {
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // The browser can hold locks on Windows briefly; a leftover temp profile is harmless.
  }
}

const report = {
  artifact: {
    name: bundle.artifactName,
    bytes: bundle.artifactSize,
    sha256: bundle.artifactSha256,
  },
  generatedOn: process.platform,
  total: results.length,
  failed,
  cases: results,
};

if (jsonPath) {
  const target = path.isAbsolute(jsonPath) ? jsonPath : path.join(root, jsonPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  log(`\nWrote ${path.relative(root, target)}`);
}

log("");
const worstOverall = results.reduce(
  (worst, entry) => Math.max(worst, entry.result.overflow.maxEscape),
  0,
);
log(`${results.length - failed}/${results.length} case(s) clean; worst escape ${worstOverall}px.`);

if (failed > 0 && !reportOnly) {
  console.error(
    `\nLayout probe failed: ${failed}/${results.length} case(s) render content outside the visual root.`,
  );
  process.exit(1);
}
