import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { capturePage, findBrowser, launchBrowser } from "./browser.mjs";
import { readPngHeader } from "./png-utils.mjs";

/**
 * Renders `assets/icon.svg` to `assets/icon.png` at exactly 20x20.
 *
 * Microsoft documents the visual icon as "a PNG file with dimensions 20 pixels by 20
 * pixels" (https://learn.microsoft.com/en-us/power-bi/developer/visuals/visual-project-structure).
 *
 * powerbi-visuals-tools does not enforce that: it base64-encodes whatever `assets.icon`
 * points at, maps `.svg` to an `image/svg+xml` data URI, and then hard-codes
 * `assets: { icon: "assets/icon.png" }` into the packaged manifest regardless. Pointing at
 * an SVG therefore ships a package whose manifest claims PNG while the payload is SVG, and
 * relies on an undocumented tolerance during certification. This script removes that gamble.
 *
 * The PNG is a real browser render of the committed SVG, not hand-authored pixels, and the
 * result is byte-verified before it is written.
 */

const ICON_SIZE = 20;

const root = process.cwd();
const svgPath = path.join(root, "assets", "icon.svg");
const pngPath = path.join(root, "assets", "icon.png");

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const svg = readFileSync(svgPath, "utf8").trim();
ensure(svg.startsWith("<svg"), `${svgPath} is not an SVG.`);

const html = [
  "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>",
  "*{margin:0;padding:0;border:0}",
  `html,body{width:${ICON_SIZE}px;height:${ICON_SIZE}px;overflow:hidden;background:transparent}`,
  `svg{display:block;width:${ICON_SIZE}px;height:${ICON_SIZE}px}`,
  "</style></head><body>",
  svg,
  "</body></html>",
].join("");

const browserPath = findBrowser();
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), "atlyn-icon-"));
const browser = await launchBrowser(browserPath, profileDirectory, [
  `--window-size=${ICON_SIZE},${ICON_SIZE}`,
]);

console.log(`Browser: ${browserPath}`);

try {
  const { buffer } = await capturePage(browser, {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    width: ICON_SIZE,
    height: ICON_SIZE,
    transparent: true,
    readyExpression: `({ ready: document.readyState === "complete" && !!document.querySelector("svg") })`,
  });

  const header = readPngHeader(buffer);
  ensure(
    header.width === ICON_SIZE && header.height === ICON_SIZE,
    `Expected a ${ICON_SIZE}x${ICON_SIZE} icon, got ${header.width}x${header.height}.`,
  );

  writeFileSync(pngPath, buffer);
  console.log(
    `Wrote assets/icon.png  ${header.width}x${header.height}  ${buffer.length} bytes  `
    + `sha256=${createHash("sha256").update(buffer).digest("hex")}`,
  );
} finally {
  await browser.close();
  try {
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // The browser can hold locks on Windows briefly; a leftover temp profile is harmless.
  }
}
