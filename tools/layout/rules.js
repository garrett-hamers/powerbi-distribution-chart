/**
 * Layout rules, as pure functions over plain measurements.
 *
 * Nothing here touches the DOM. Every rule takes numbers and strings that a browser
 * produced elsewhere and returns a list of human-readable failures. That separation is
 * the point: a rule that can only ever be fed a correct render is a rule nobody has
 * watched fail, and a rule nobody has watched fail is indistinguishable from a rule that
 * cannot fail. Keeping them pure lets the unit tests drive them with deliberately bad
 * measurements - collapsed sticky headers, regions that stopped scrolling, z-index read
 * out of a stacking context that does not exist - none of which the real visual produces.
 */

const TOLERANCE_PX = 0.5;

/**
 * Scroll offsets worth sampling for a region: the top, the middle, and the very bottom.
 *
 * At-rest measurement only ever sees offset 0. A sibling repository found a region with
 * 24,467px of travel, where a defect at offset 12,000 is completely invisible until
 * something actually scrolls.
 */
function scrollOffsetsFor(maxScrollTop) {
  const max = Math.max(0, Math.floor(maxScrollTop));
  if (max === 0) {
    return [0];
  }
  const middle = Math.floor(max / 2);
  return [...new Set([0, middle, max])];
}

/**
 * Checks the scroll regions actually found against what the caller declared it expects.
 *
 * Three distinct failures, deliberately kept apart rather than collapsed into "mismatch":
 *
 *   - an expected region is **missing entirely**, so every assertion that named it would
 *     now silently apply to nothing;
 *   - an expected region **is no longer overflowing** (`scrollHeight <= clientHeight`),
 *     which is the vacuous-fixture trap: it still exists, scroll-time checks still "run",
 *     and they all pass because there is nowhere to scroll to;
 *   - a region **appeared that nobody declared**, which means new scrollable content has
 *     shipped without anyone deciding what its scroll-time contract is.
 *
 * The third is why this cannot simply skip when no regions are found. A visual with no
 * scroll containers is a fine and stable state, but it has to be an asserted state, or
 * the day one appears it arrives with no coverage at all.
 */
function evaluateScrollExpectations(regions, expectations = []) {
  const failures = [];
  const seen = new Set();

  for (const expectation of expectations) {
    const region = regions.find((candidate) => candidate.selector === expectation.selector);
    if (!region) {
      failures.push(
        `expected scroll region "${expectation.selector}" was not found; `
        + "every scroll-time assertion naming it would now apply to nothing",
      );
      continue;
    }
    seen.add(region.selector);

    if (region.scrollHeight <= region.clientHeight) {
      failures.push(
        `scroll region "${region.selector}" no longer overflows `
        + `(scrollHeight ${region.scrollHeight} <= clientHeight ${region.clientHeight}); `
        + "it has stopped being a scroll container, so its scroll-time checks would pass vacuously",
      );
      continue;
    }

    const minimum = expectation.minScrollTop ?? 1;
    if (region.maxScrollTop < minimum) {
      failures.push(
        `scroll region "${region.selector}" can only travel ${region.maxScrollTop}px, `
        + `below the declared minimum of ${minimum}px`,
      );
    }
  }

  for (const region of regions) {
    if (!seen.has(region.selector)) {
      failures.push(
        `undeclared scroll region "${region.selector}" (${region.maxScrollTop}px of travel). `
        + "New scrollable content needs a declared scroll-time contract, otherwise it ships with no coverage",
      );
    }
  }

  return failures;
}

/**
 * Checks a set of sticky elements for collapse.
 *
 * The header-pinning bug is that sticky elements pin to the *same* place and land on top
 * of one another, hiding all but the last. At rest they are laid out normally and look
 * perfect, so this is only ever visible once something scrolls.
 *
 * Collapse is a two-dimensional question, not a question about `top` alone. A row of
 * sticky column headers all pin to `top: 0` and are entirely correct - they sit side by
 * side. Only elements whose boxes overlap in *both* axes have actually landed on each
 * other. Comparing tops alone reports every sticky table header in existence as broken,
 * which is how a rule earns its way into being ignored.
 *
 * @param samples measurements in document order, each `{ selector, top, height, left, width, position }`
 */
function evaluateStickyOffsets(samples, options = {}) {
  const failures = [];
  const tolerance = options.tolerance ?? TOLERANCE_PX;

  const notSticky = samples.filter((sample) => sample.position !== "sticky");
  if (notSticky.length > 0) {
    failures.push(
      `${notSticky.length} element(s) were measured as sticky but compute `
      + `"${notSticky.map((sample) => sample.position).join(", ")}"; `
      + "sticky behaviour cannot be asserted on an element that is not sticky",
    );
  }

  const overlaps = (startA, sizeA, startB, sizeB) => (
    Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB) > tolerance
  );
  // Horizontal extent is optional so callers measuring a purely vertical stack can omit
  // it; a missing width is treated as "shares the column", which is the stacking case.
  const left = (sample) => sample.left ?? 0;
  const width = (sample) => sample.width ?? Number.POSITIVE_INFINITY;

  for (let index = 0; index < samples.length; index += 1) {
    for (let other = index + 1; other < samples.length; other += 1) {
      const first = samples[index];
      const second = samples[other];

      const sameColumn = overlaps(left(first), width(first), left(second), width(second));
      if (!sameColumn) {
        // Side by side, like a row of sticky column headers. Nothing to collide with.
        continue;
      }

      if (overlaps(first.top, first.height, second.top, second.height)) {
        const coincident = Math.abs(first.top - second.top) <= tolerance;
        failures.push(coincident
          ? `sticky elements "${first.selector}" and "${second.selector}" have collapsed `
            + `onto the same offset (both at top ${second.top}px)`
          : `sticky element "${second.selector}" at ${second.top}px overlaps `
            + `"${first.selector}", which extends to ${Math.round((first.top + first.height) * 100) / 100}px`);
        continue;
      }

      if (other === index + 1 && second.top < first.top) {
        failures.push(
          `sticky elements are out of order: "${second.selector}" pins at ${second.top}px, `
          + `above "${first.selector}" at ${first.top}px`,
        );
      }
    }
  }

  return failures;
}

/**
 * Checks a claimed stacking order.
 *
 * `getComputedStyle().zIndex` returns the *specified* value whether or not the element is
 * positioned, so a stacking assertion will happily read a confident-looking order out of
 * a stacking context that does not exist. A sibling repository's stacking checks passed
 * green while every element involved computed `position: static`. The z-index comparison
 * here therefore refuses to run until the elements are actually positioned.
 */
function evaluateStackingOrder(samples, options = {}) {
  const failures = [];
  const requiredPosition = options.requiredPosition ?? "sticky";

  const unpositioned = samples.filter((sample) => sample.position === "static");
  if (unpositioned.length > 0) {
    failures.push(
      `z-index cannot be compared on ${unpositioned.length} element(s) computing `
      + `position: static (${unpositioned.map((sample) => sample.selector).join(", ")}); `
      + "z-index is inert without positioning, so any order read from them is imaginary",
    );
    return failures;
  }

  const wrongPosition = samples.filter((sample) => sample.position !== requiredPosition);
  if (wrongPosition.length > 0) {
    failures.push(
      `expected every element in the stacking claim to compute position: ${requiredPosition}, `
      + `but found ${wrongPosition.map((sample) => `${sample.selector} is ${sample.position}`).join(", ")}`,
    );
    return failures;
  }

  const withoutZIndex = samples.filter((sample) => sample.zIndex === "auto" || sample.zIndex === "" || sample.zIndex === null);
  if (withoutZIndex.length > 0) {
    failures.push(
      `${withoutZIndex.length} element(s) in the stacking claim have no z-index `
      + `(${withoutZIndex.map((sample) => sample.selector).join(", ")}), so their order is document order, not the claimed one`,
    );
  }

  return failures;
}

/**
 * Checks that nothing positioned has escaped the visual root's containing block.
 *
 * An absolutely positioned child of a `position: static` root resolves against the
 * initial containing block: it leaves the root's `overflow: hidden` entirely and belongs
 * to the page rather than to the visual, which is invisible to an overflow walk scoped to
 * the root because the element is no longer laid out relative to it at all.
 */
function evaluateRootContainment(positioning) {
  const failures = [];

  if (!positioning.rootIsPositioned && positioning.absoluteCount > 0) {
    failures.push(
      `the visual root computes position: ${positioning.rootPosition} while holding `
      + `${positioning.absoluteCount} absolutely positioned descendant(s), which resolve `
      + "against the initial containing block and belong to the page rather than the visual",
    );
  }

  for (const escapee of positioning.escapees ?? []) {
    failures.push(
      `"${escapee.selector}" (position: ${escapee.position}) resolves against `
      + `${escapee.containingBlock}, which is outside the visual root`,
    );
  }

  for (const entry of positioning.zIndexOnUnpositioned ?? []) {
    failures.push(
      `"${entry.selector}" specifies z-index ${entry.zIndex} but is not positioned, `
      + "so the z-index is inert and any stacking order read from it is imaginary",
    );
  }

  return failures;
}

module.exports = {
  scrollOffsetsFor,
  evaluateScrollExpectations,
  evaluateStickyOffsets,
  evaluateStackingOrder,
  evaluateRootContainment,
};
