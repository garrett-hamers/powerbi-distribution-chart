import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Proves the layout fixes are load-bearing.
 *
 * A green probe only means "nothing overflows today". It does not tell you whether the
 * checks would have caught the defects they were written for, and a check that cannot be
 * made to fail is worth nothing - one sibling repository shipped a geometry assertion
 * whose all-zero expectation *was itself the bug*, because it ran in JSDOM and could
 * never fail.
 *
 * So each fix is reverted in turn, the visual is repackaged, and the layout probe is run
 * over the cases that fix governs. The probe is required to go red. If it stays green,
 * the fix is either unnecessary or the probe is not actually testing it, and either way
 * this script fails.
 *
 * Usage: node scripts/prove-regressions.mjs [--filter <id>]
 */

const root = process.cwd();
const sourcePath = path.join(root, "src", "visual.ts");
const relativeSource = path.relative(root, sourcePath);

/**
 * Each entry undoes exactly one fix by rewriting the source it introduced, then names
 * the probe cases that must break as a result.
 */
const REGRESSIONS = [
  {
    id: "responsive-margins",
    title: "Reserved bands shrink with the tile",
    detail:
      "A constant 90px value gutter plus a 24px edge margin exceeds an 80px tile, so the "
      + "plot origin lands past the right edge and the entire chart is drawn outside the "
      + "clipped root.",
    edits: [{
      from: "    const horizontalScale = Math.min(1, (viewport.width * MAX_MARGIN_SHARE) / preferredHorizontal);",
      to: "    const horizontalScale = 1;",
    }],
    filter: "standard|default|en-US|80x80",
    expectSelector: "atlyn-box",
  },
  {
    id: "slot-clamped-glyphs",
    title: "Minimum glyph sizes are capped by the space available",
    detail:
      "A 28px minimum box, a 36px minimum hit target and an 8px minimum marker radius are "
      + "comfortable defaults on a large tile and impossible demands on a small one. Floors "
      + "that cannot shrink are how content ends up outside a clipped root.",
    edits: [{
      from: "    const slotHalf = Math.max(\n      1,\n      Math.min(categoryWidth * 0.5, center - 1, viewport.width - center - 1),\n    );",
      to: "    const slotHalf = Number.POSITIVE_INFINITY;",
    }],
    filter: "many-categories|default|en-US|80x80",
    expectSelector: "atlyn-box",
  },
  {
    id: "svg-text-fitting",
    title: "SVG text runs are measured and trimmed",
    detail:
      "SVG <text> neither wraps nor truncates, and `text-overflow: ellipsis` does nothing "
      + "to it. Without an explicit measure-and-trim pass a long category name or a "
      + "full-sentence state message simply runs off both sides of the tile.",
    edits: [{
      from: "function fitSvgText(fit: TextFit): void {\n  layoutSvgText(fit);\n  clampTextBottom(fit);\n}",
      to: "function fitSvgText(fit: TextFit): void {\n"
        + "  if ((globalThis as { __atlynFitText?: boolean }).__atlynFitText === true) {\n"
        + "    layoutSvgText(fit);\n    clampTextBottom(fit);\n  }\n}",
    }],
    filter: "long-labels|default|en-US|398x298",
    expectSelector: "text",
  },
  {
    id: "bounded-status-band",
    title: "The status band is bounded, and dropped when it cannot fit",
    detail:
      "The row-count sentence is ~100 characters. Left to wrap freely inside an absolutely "
      + "positioned band it grew to 144px inside an 80px tile. Bounding the band and "
      + "dropping it on tiles too small to carry it are two halves of one change: either "
      + "half alone keeps the band inside the root, so they are proven together.",
    edits: [
      {
        from: "    const visible = viewport.width >= MIN_DIAGNOSTICS_WIDTH && viewport.height >= MIN_DIAGNOSTICS_HEIGHT;",
        to: "    const visible = true;",
      },
      {
        from: "    text.style.display = \"block\";\n    text.style.maxWidth = \"100%\";\n"
          + "    text.style.whiteSpace = \"nowrap\";\n    text.style.overflow = \"hidden\";\n"
          + "    text.style.textOverflow = \"ellipsis\";",
        to: "    text.style.display = \"inline\";",
      },
      {
        from: "    this.diagnostics.style.maxHeight = `${DIAGNOSTICS_BAND_HEIGHT - 4}px`;\n"
          + "    this.diagnostics.style.overflow = \"hidden\";",
        to: "",
      },
    ],
    filter: "standard|default|en-US|80x80",
    expectSelector: "atlyn-diagnostics",
  },
];

const argv = process.argv.slice(2);
const filterIndex = argv.indexOf("--filter");
const only = filterIndex === -1 ? undefined : argv[filterIndex + 1];
const selected = only ? REGRESSIONS.filter((entry) => entry.id === only) : REGRESSIONS;

if (selected.length === 0) {
  console.error(`No regression named "${only}". Known: ${REGRESSIONS.map((entry) => entry.id).join(", ")}.`);
  process.exit(1);
}

const runNode = (args) => spawnSync(process.execPath, args, {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  windowsHide: true,
});

const runPackage = () => {
  const result = runNode([path.join("scripts", "package.mjs")]);
  if (result.status !== 0) {
    throw new Error(`Packaging failed:\n${result.stdout}\n${result.stderr}`);
  }
};

const runProbe = (probeFilter) => {
  const reportPath = path.join(".tmp", "prove-regressions", `${probeFilter.replace(/[^a-z0-9]+/gi, "-")}.json`);
  const result = runNode([
    path.join("scripts", "layout-probe.mjs"),
    "--skip-package",
    "--quiet",
    "--filter",
    probeFilter,
    "--json",
    reportPath,
  ]);
  let report;
  let reportError;
  try {
    report = JSON.parse(readFileSync(path.join(root, reportPath), "utf8"));
  } catch (error) {
    report = undefined;
    reportError = error instanceof Error ? error.message : String(error);
  }
  return { ...result, report, reportError };
};

const original = readFileSync(sourcePath, "utf8");
// Git normalizes line endings per platform, so anchors written with \n have to be
// re-encoded to whatever this checkout actually uses or they silently match nothing.
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const toSourceEol = (text) => text.replace(/\r?\n/g, eol);

const restore = () => {
  writeFileSync(sourcePath, original, "utf8");
};

let failures = 0;

process.on("exit", () => {
  // Never leave a reverted source behind, whatever happens.
  if (readFileSync(sourcePath, "utf8") !== original) {
    restore();
  }
});

try {
  console.log("Baseline: packaging the fixed visual and confirming the probe is green.\n");
  runPackage();

  for (const regression of selected) {
    const baseline = runProbe(regression.filter);
    if (baseline.report === undefined) {
      console.error(
        `The layout probe did not complete while establishing the baseline for `
        + `"${regression.id}" (exit ${baseline.status}, no JSON report: ${baseline.reportError}).\n`
        + `probe stdout:\n${(baseline.stdout ?? "").trim() || "(empty)"}\n`
        + `probe stderr:\n${(baseline.stderr ?? "").trim() || "(empty)"}`,
      );
      process.exit(1);
    }
    if (baseline.status !== 0) {
      console.error(
        `Baseline probe for "${regression.id}" is already failing on ${regression.filter}. `
        + "The fixes must be green before a reversion can prove anything.\n"
        + `${baseline.stdout}\n${baseline.stderr}`,
      );
      process.exit(1);
    }
  }
  console.log("Baseline is green for every governed case.\n");

  for (const regression of selected) {
    console.log(`--- ${regression.id}: ${regression.title}`);

    let reverted = original;
    for (const edit of regression.edits) {
      const anchor = toSourceEol(edit.from);
      const occurrences = reverted.split(anchor).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `Reversion "${regression.id}" expected exactly one occurrence of its anchor in `
          + `${relativeSource}, found ${occurrences}. The anchor is stale:\n${edit.from}`,
        );
      }
      reverted = reverted.replace(anchor, toSourceEol(edit.to));
    }

    writeFileSync(sourcePath, reverted, "utf8");
    try {
      runPackage();
      const probe = runProbe(regression.filter);
      if (probe.report === undefined) {
        // No report means the probe did not finish - a browser launch timeout, a page that
        // never became ready, a crash. That is not the same as "this fix is unproven", and
        // conflating the two would let an infrastructure failure masquerade as a verdict
        // about the code. Fail loudly, with whatever the probe managed to say.
        throw new Error([
          `The layout probe did not complete while proving "${regression.id}" `
          + `(exit ${probe.status}, no JSON report: ${probe.reportError}).`,
          "This says nothing about the fix - the probe never produced a verdict.",
          `probe stdout:\n${(probe.stdout ?? "").trim() || "(empty)"}`,
          `probe stderr:\n${(probe.stderr ?? "").trim() || "(empty)"}`,
        ].join("\n"));
      }

      const wentRed = probe.status !== 0;
      const cases = probe.report.cases ?? [];
      const offenders = cases.flatMap((entry) => entry.result.overflow.overflows);
      // Match on everything the probe recorded, not just overflow selectors. A reversion
      // can legitimately be caught by a non-overflow rule, and when the match fails the
      // reason has to be printed rather than swallowed - "nothing matched" is not a
      // diagnosis.
      const recordedFailures = cases.flatMap((entry) => entry.failures ?? []);
      const haystack = [
        ...offenders.map((entry) => entry.selector),
        ...recordedFailures,
      ];
      const matched = offenders.find((entry) => entry.selector.includes(regression.expectSelector));
      const matchedText = haystack.some((text) => text.includes(regression.expectSelector));

      if (wentRed && matchedText) {
        const worst = offenders.reduce((peak, entry) => Math.max(peak, entry.escape), 0);
        console.log(`    PROVEN  probe went red on ${regression.filter} (worst escape ${worst}px)`);
        if (matched) {
          console.log(
            `            ${matched.selector} escapes by ${matched.escape}px `
            + `(l${matched.left} t${matched.top} r${matched.right} b${matched.bottom})`,
          );
        } else {
          const failure = recordedFailures.find((text) => text.includes(regression.expectSelector));
          console.log(`            ${failure}`);
        }
      } else if (!wentRed) {
        failures += 1;
        console.error(
          `    UNPROVEN  reverting this fix left the probe green on ${regression.filter}. `
          + "The fix is either unnecessary or the probe does not exercise it.",
        );
      } else {
        failures += 1;
        console.error(
          `    UNPROVEN  probe went red on ${regression.filter} but nothing matching `
          + `"${regression.expectSelector}" was reported, so it failed for some other reason.`,
        );
        console.error(`              recorded failures: ${recordedFailures.join(" | ") || "(none)"}`);
        console.error(`              overflow selectors: ${offenders.map((entry) => entry.selector).join(", ") || "(none)"}`);
      }
      console.log(`            ${regression.detail}\n`);
    } finally {
      restore();
    }
  }
} finally {
  restore();
  runPackage();
}

if (failures > 0) {
  console.error(`${failures}/${selected.length} fix(es) could not be shown to fail without their patch.`);
  process.exit(1);
}

console.log(`All ${selected.length} fix(es) proven: each one, reverted on its own, makes the layout probe fail.`);
