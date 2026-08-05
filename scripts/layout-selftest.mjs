import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBrowser, launchBrowser, openPage } from "./browser.mjs";
import rules from "../tools/layout/rules.js";

const {
  evaluateRootContainment,
  evaluateScrollExpectations,
  evaluateStackingOrder,
  evaluateStickyOffsets,
  scrollOffsetsFor,
} = rules;

/**
 * Proves the layout rules are live.
 *
 * Atlyn Distribution has no scroll containers and no sticky elements, so the scroll walk
 * and the sticky rules never fire against the real visual. That is a genuine result about
 * the visual - but it leaves those checks unobserved, and machinery nobody has watched
 * work is indistinguishable from machinery that cannot work. A sibling repository shipped
 * exactly that: it detected a scroll container, never scrolled it, and every scroll-time
 * assertion was dead weight over a region with 24,467px of travel.
 *
 * So each rule is pointed at a DOM built to break it, in the same real Chromium the probe
 * uses, and required to produce the failure it exists to produce. Two of the fixtures are
 * healthy rather than broken: a rule that fires on correct layout would be just as
 * worthless as one that never fires.
 *
 * Usage: node scripts/layout-selftest.mjs [--quiet]
 */

const root = process.cwd();
const toolsDirectory = path.join(root, "tools");
const quiet = process.argv.includes("--quiet");

const log = (message) => {
  if (!quiet) {
    console.log(message);
  }
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const startServer = () => new Promise((resolve) => {
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
    const candidate = path.join(toolsDirectory, path.normalize(requestPath).replace(/^([/\\])+/, ""));
    const relative = path.relative(toolsDirectory, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(candidate)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(candidate)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(candidate));
  });
  server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
});

/**
 * Renders one fixture, walks every scroll region it has, and applies the same rules the
 * real probe applies. Judgement happens here in Node rather than in the page, so these are
 * literally the unit-tested functions and not a second copy of them.
 */
async function measureFixture(page, fixture, expectedRegions = []) {
  const response = await page.evaluate(`window.__atlynSelfTest.run(${JSON.stringify({ fixture })})`);
  if (!response?.ok) {
    throw new Error(`Fixture ${fixture} threw:\n${response?.error}`);
  }
  const measured = response.result;

  const offsetsWalked = [];
  const stickyUnderScroll = [];
  let worstUnderScroll = 0;
  let maxTravel = 0;

  for (const region of measured.scrollRegions) {
    maxTravel = Math.max(maxTravel, region.maxScrollTop);
    for (const offset of scrollOffsetsFor(region.maxScrollTop)) {
      const scrolled = await page.evaluate(
        `window.__atlynSelfTest.scrollTo(${JSON.stringify(region.selector)}, ${offset})`,
      );
      if (!scrolled?.ok || !scrolled.result.found) {
        throw new Error(`Scrolling ${region.selector} to ${offset} failed in fixture ${fixture}.`);
      }
      const sample = scrolled.result;
      offsetsWalked.push(sample.applied);
      worstUnderScroll = Math.max(worstUnderScroll, sample.overflow.maxEscape);
      if (sample.sticky.length > 1) {
        const failures = evaluateStickyOffsets(sample.sticky);
        if (failures.length > 0) {
          stickyUnderScroll.push({ offset: sample.applied, failures });
        }
      }
    }
  }

  return {
    fixture,
    atRestEscape: measured.atRest.maxEscape,
    rootPosition: measured.positioning.rootPosition,
    offsetsWalked,
    maxTravel,
    worstUnderScroll,
    containment: evaluateRootContainment(measured.positioning),
    scrollExpectations: evaluateScrollExpectations(measured.scrollRegions, expectedRegions),
    stickyAtRest: measured.sticky.length > 1 ? evaluateStickyOffsets(measured.sticky) : [],
    stickyUnderScroll,
    stacking: evaluateStackingOrder(
      measured.sticky.length > 0
        ? measured.sticky
        : measured.positioning.zIndexOnUnpositioned.map((entry) => ({ ...entry, position: "static" })),
    ),
  };
}

/**
 * Each expectation names the rule under test and what the fixture must provoke from it.
 * `expect` receives the fixture's measurements and returns a reason string when the rule
 * did *not* behave as required, so a rule that silently stops working fails here.
 */
const EXPECTATIONS = [
  {
    fixture: "escape-only-under-scroll",
    rule: "scroll walk",
    why: "A defect below the fold is invisible at rest. Only scrolling reveals it.",
    expect: (result) => {
      if (result.maxTravel < 100) {
        return `fixture stopped overflowing (max travel ${result.maxTravel}px), so the walk proves nothing`;
      }
      if (result.offsetsWalked.length < 3) {
        return `walk only reached offsets ${result.offsetsWalked.join(", ")}; expected top, middle and maximum`;
      }
      if (Math.max(...result.offsetsWalked) < result.maxTravel) {
        return `walk never reached the bottom (${Math.max(...result.offsetsWalked)}px of ${result.maxTravel}px)`;
      }
      if (result.atRestEscape > 0) {
        return `the defect was already visible at rest (${result.atRestEscape}px), so it does not prove the walk found anything new`;
      }
      if (result.worstUnderScroll <= 0) {
        return "scrolling revealed no escape at all; the walk did not detect the planted defect";
      }
      return null;
    },
    report: (result) => `at rest ${result.atRestEscape}px, under scroll ${result.worstUnderScroll}px `
      + `across offsets ${result.offsetsWalked.join("/")} of ${result.maxTravel}px`,
  },
  {
    fixture: "collapsed-sticky",
    rule: "sticky offsets",
    why: "Sticky headers that pin to one offset collapse onto each other; at rest they look perfect.",
    expect: (result) => {
      if (result.stickyUnderScroll.length === 0) {
        return "no sticky failure was reported at any scroll offset, though every header pins to top: 0";
      }
      const collapsed = result.stickyUnderScroll.some((entry) => entry.failures.some((failure) => failure.includes("collapsed")));
      return collapsed ? null : `sticky failures were reported but none identified a collapse: ${JSON.stringify(result.stickyUnderScroll)}`;
    },
    report: (result) => {
      const first = result.stickyUnderScroll[0];
      return `${result.stickyUnderScroll.length} offset(s) reported collapse, first at ${first.offset}px: ${first.failures[0]}`;
    },
  },
  {
    fixture: "healthy-sticky",
    rule: "sticky offsets (negative control)",
    why: "A rule that also fires on correct layout would be worthless.",
    expect: (result) => {
      if (result.stickyUnderScroll.length > 0) {
        return `staggered sticky headers were wrongly reported as broken: ${JSON.stringify(result.stickyUnderScroll)}`;
      }
      if (result.stickyAtRest.length > 0) {
        return `staggered sticky headers were wrongly reported as broken at rest: ${result.stickyAtRest.join("; ")}`;
      }
      if (result.maxTravel < 100) {
        return `fixture stopped overflowing (max travel ${result.maxTravel}px), so the control proves nothing`;
      }
      return null;
    },
    report: (result) => `clean across offsets ${result.offsetsWalked.join("/")} of ${result.maxTravel}px, as required`,
  },
  {
    fixture: "sticky-column-headers",
    rule: "sticky offsets (column-header control)",
    why: "Sticky column headers all share top: 0 and are correct; a rule comparing tops alone calls them all broken.",
    expectedRegions: [{ selector: "div.selftest-panel", minScrollTop: 100 }],
    expect: (result) => {
      if (result.stickyUnderScroll.length > 0) {
        return `side-by-side column headers were wrongly reported as collapsed: ${JSON.stringify(result.stickyUnderScroll)}`;
      }
      if (result.maxTravel < 100) {
        return `fixture stopped overflowing (max travel ${result.maxTravel}px), so the control proves nothing`;
      }
      return null;
    },
    report: (result) => `three headers sharing top: 0 accepted across offsets ${result.offsetsWalked.join("/")} of ${result.maxTravel}px`,
  },
  {
    fixture: "static-root-absolute-child",
    rule: "root containment",
    why: "An absolute child of a static root resolves against the initial containing block and leaves the visual.",
    expect: (result) => {
      if (result.rootPosition !== "static") {
        return `fixture root computed ${result.rootPosition}, so it does not exercise the rule`;
      }
      return result.containment.length > 0
        ? null
        : "a static root holding an absolutely positioned child was reported as clean";
    },
    report: (result) => `root computed ${result.rootPosition}: ${result.containment[0]}`,
  },
  {
    fixture: "zindex-on-static",
    rule: "stacking guard",
    why: "getComputedStyle().zIndex returns the specified value even when the element is not positioned.",
    expect: (result) => {
      const flagged = result.containment.some((failure) => failure.includes("inert"))
        || result.stacking.some((failure) => failure.includes("static") || failure.includes("inert"));
      return flagged ? null : "a z-index on an unpositioned element was accepted without complaint";
    },
    report: (result) => (result.containment[0] ?? result.stacking[0]),
  },
  {
    fixture: "region-stopped-overflowing",
    rule: "scroll expectations",
    why: "A declared region that stops overflowing makes every downstream scroll assertion pass vacuously.",
    expectedRegions: [{ selector: "div.selftest-panel", minScrollTop: 100 }],
    expect: (result) => {
      const flagged = result.scrollExpectations.some((failure) => failure.includes("no longer overflows"));
      return flagged
        ? null
        : `a declared region that stopped overflowing was not reported: ${JSON.stringify(result.scrollExpectations)}`;
    },
    report: (result) => result.scrollExpectations[0],
  },
  {
    fixture: "healthy-sticky",
    rule: "undeclared scroll region",
    why: "New scrollable content must arrive with a declared contract, not with no coverage.",
    expectedRegions: [],
    expect: (result) => {
      const flagged = result.scrollExpectations.some((failure) => failure.includes("undeclared scroll region"));
      return flagged ? null : "a scroll region that nobody declared was accepted silently";
    },
    report: (result) => result.scrollExpectations[0],
  },
];

const READY_EXPRESSION = `(() => ({
  ready: document.documentElement.dataset.selftestReady === "true",
  error: document.documentElement.dataset.selftestError,
}))()`;

const browserPath = findBrowser();
const { server, port } = await startServer();
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), "atlyn-selftest-"));

log(`Browser: ${browserPath}`);
log(`Fixtures: http://127.0.0.1:${port}/layout/selftest.html`);
log("");
log("Each rule is pointed at a DOM built to break it, and required to notice.");
log("");

const browser = await launchBrowser(browserPath, profileDirectory, ["--window-size=900,600"]);
let failed = 0;

try {
  const page = await openPage(browser, {
    url: `http://127.0.0.1:${port}/layout/selftest.html`,
    width: 900,
    height: 600,
  });

  try {
    await page.waitForReady(READY_EXPRESSION);

    for (const expectation of EXPECTATIONS) {
      const result = await measureFixture(page, expectation.fixture, expectation.expectedRegions);
      const reason = expectation.expect(result);
      if (reason === null) {
        log(`  LIVE  ${expectation.rule.padEnd(34)} ${expectation.report(result)}`);
      } else {
        failed += 1;
        console.error(`  DEAD  ${expectation.rule.padEnd(34)} ${reason}`);
      }
      log(`        ${expectation.why}`);
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

log("");
if (failed > 0) {
  console.error(`${failed}/${EXPECTATIONS.length} layout rule(s) did not behave as required.`);
  process.exit(1);
}
log(`All ${EXPECTATIONS.length} layout rule(s) proven live against a real browser.`);
