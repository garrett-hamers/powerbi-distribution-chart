import rules, {
  type PositioningMeasurement,
  type ScrollRegionMeasurement,
  type StickyMeasurement,
} from "../tools/layout/rules.js";

const {
  evaluateRootContainment,
  evaluateScrollExpectations,
  evaluateStackingOrder,
  evaluateStickyOffsets,
  scrollOffsetsFor,
} = rules;

/**
 * Unit tests for the layout rules.
 *
 * These run in JSDOM, which has no layout engine - so they deliberately never measure
 * anything. Every input here is a hand-written set of numbers standing in for a browser
 * measurement, which is the whole reason the rules were kept as pure functions: it lets
 * them be driven with collapsed sticky headers, regions that stopped scrolling, and
 * z-index read out of a stacking context that does not exist. The real visual produces
 * none of those, so without this the rules would only ever be shown correct input.
 *
 * The geometry itself is measured in a real browser by `npm run layout-probe`, and the
 * rules are proven to fire against a real engine by `npm run layout-selftest`. Nothing
 * here asserts a rectangle, because a rectangle asserted in JSDOM is always zero and the
 * assertion could never fail.
 */

describe("scrollOffsetsFor", () => {
  test("samples the top, middle and bottom of a region with travel", () => {
    expect(scrollOffsetsFor(1000)).toEqual([0, 500, 1000]);
  });

  test("collapses to a single sample when there is nowhere to scroll", () => {
    expect(scrollOffsetsFor(0)).toEqual([0]);
    expect(scrollOffsetsFor(-5)).toEqual([0]);
  });

  test("does not emit duplicate offsets for a one-pixel region", () => {
    expect(scrollOffsetsFor(1)).toEqual([0, 1]);
  });
});

describe("evaluateScrollExpectations", () => {
  const region = (overrides: Partial<ScrollRegionMeasurement> = {}): ScrollRegionMeasurement => ({
    selector: "div.panel",
    scrollHeight: 1200,
    clientHeight: 200,
    maxScrollTop: 1000,
    ...overrides,
  });

  test("accepts a declared region that still overflows", () => {
    expect(evaluateScrollExpectations([region()], [{ selector: "div.panel" }])).toEqual([]);
  });

  test("fails when a declared region has vanished entirely", () => {
    const failures = evaluateScrollExpectations([], [{ selector: "div.panel" }]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("was not found");
  });

  test("fails when a declared region has stopped overflowing", () => {
    // The vacuous-fixture trap: the region still exists and scroll-time checks still
    // "run", but there is nowhere to scroll to, so they all pass without testing anything.
    const failures = evaluateScrollExpectations(
      [region({ scrollHeight: 200, clientHeight: 200, maxScrollTop: 0 })],
      [{ selector: "div.panel" }],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no longer overflows");
    expect(failures[0]).toContain("vacuously");
  });

  test("fails when a region travels less than its declared minimum", () => {
    const failures = evaluateScrollExpectations(
      [region({ scrollHeight: 210, clientHeight: 200, maxScrollTop: 10 })],
      [{ selector: "div.panel", minScrollTop: 500 }],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("below the declared minimum");
  });

  test("fails on a scroll region nobody declared", () => {
    // This is what makes an empty expectation list a real check rather than a skip.
    const failures = evaluateScrollExpectations([region()], []);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("undeclared scroll region");
  });

  test("is silent when there are no regions and none were expected", () => {
    expect(evaluateScrollExpectations([], [])).toEqual([]);
  });
});

describe("evaluateStickyOffsets", () => {
  const sticky = (selector: string, top: number, height = 20): StickyMeasurement => ({
    selector,
    top,
    height,
    position: "sticky",
    zIndex: "1",
  });

  test("accepts staggered headers that stay distinct", () => {
    expect(evaluateStickyOffsets([
      sticky("h3.a", 0),
      sticky("h3.b", 20),
      sticky("h3.c", 40),
    ])).toEqual([]);
  });

  test("accepts a row of sticky column headers that share an offset side by side", () => {
    // Column headers in one row all pin to top: 0 and are entirely correct - they sit
    // next to each other. Comparing tops alone reports every sticky table header in
    // existence as broken, which is how a rule earns its way into being ignored.
    expect(evaluateStickyOffsets([
      { selector: "th.a", position: "sticky", top: 0, height: 18, left: 0, width: 60 },
      { selector: "th.b", position: "sticky", top: 0, height: 18, left: 60, width: 60 },
      { selector: "th.c", position: "sticky", top: 0, height: 18, left: 120, width: 60 },
    ])).toEqual([]);
  });

  test("still reports a collapse when the boxes overlap in both axes", () => {
    const failures = evaluateStickyOffsets([
      { selector: "th.a", position: "sticky", top: 0, height: 18, left: 0, width: 60 },
      { selector: "th.b", position: "sticky", top: 0, height: 18, left: 10, width: 60 },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("collapsed onto the same offset");
  });

  test("reports headers that collapsed onto the same offset", () => {
    const failures = evaluateStickyOffsets([
      sticky("h3.a", 0),
      sticky("h3.b", 0),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("collapsed onto the same offset");
  });

  test("reports headers that pinned out of order", () => {
    const failures = evaluateStickyOffsets([
      sticky("h3.a", 40),
      sticky("h3.b", 0),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("out of order");
  });

  test("reports headers that overlap without being exactly coincident", () => {
    // Distinct tops, increasing order, and still broken: the first is 20px tall and the
    // second starts 5px into it.
    const failures = evaluateStickyOffsets([
      sticky("h3.a", 0, 20),
      sticky("h3.b", 15, 20),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("overlaps");
  });

  test("refuses to assert sticky behaviour on an element that is not sticky", () => {
    const failures = evaluateStickyOffsets([
      { ...sticky("h3.a", 0), position: "static" },
      sticky("h3.b", 20),
    ]);
    expect(failures.some((failure: string) => failure.includes("cannot be asserted"))).toBe(true);
  });
});

describe("evaluateStackingOrder", () => {
  test("refuses to compare z-index on unpositioned elements", () => {
    // The trap: getComputedStyle().zIndex returns the specified value regardless of
    // position, so this data looks like a perfectly good stacking order and is imaginary.
    const failures = evaluateStackingOrder([
      { selector: "div.a", position: "static", zIndex: "1" },
      { selector: "div.b", position: "static", zIndex: "2" },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("inert without positioning");
  });

  test("rejects a stacking claim whose elements are not the required position", () => {
    const failures = evaluateStackingOrder([
      { selector: "div.a", position: "absolute", zIndex: "1" },
    ], { requiredPosition: "sticky" });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("expected every element");
  });

  test("reports elements whose order is document order rather than the claimed one", () => {
    const failures = evaluateStackingOrder([
      { selector: "h3.a", position: "sticky", zIndex: "auto" },
      { selector: "h3.b", position: "sticky", zIndex: "2" },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no z-index");
  });

  test("accepts a genuine stacking order on positioned elements", () => {
    expect(evaluateStackingOrder([
      { selector: "h3.a", position: "sticky", zIndex: "1" },
      { selector: "h3.b", position: "sticky", zIndex: "2" },
    ])).toEqual([]);
  });
});

describe("evaluateRootContainment", () => {
  const positioning = (overrides: Partial<PositioningMeasurement> = {}): PositioningMeasurement => ({
    rootPosition: "relative",
    rootIsPositioned: true,
    absoluteCount: 0,
    escapees: [],
    zIndexOnUnpositioned: [],
    ...overrides,
  });

  test("accepts a positioned root holding absolute descendants", () => {
    expect(evaluateRootContainment(positioning({ absoluteCount: 3 }))).toEqual([]);
  });

  test("fails a static root holding absolute descendants", () => {
    const failures = evaluateRootContainment(positioning({
      rootPosition: "static",
      rootIsPositioned: false,
      absoluteCount: 1,
    }));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("initial containing block");
  });

  test("accepts a static root with nothing absolutely positioned under it", () => {
    // An unpositioned root is only a defect in combination with an absolute descendant.
    expect(evaluateRootContainment(positioning({
      rootPosition: "static",
      rootIsPositioned: false,
      absoluteCount: 0,
    }))).toEqual([]);
  });

  test("reports an element whose containing block sits outside the root", () => {
    const failures = evaluateRootContainment(positioning({
      absoluteCount: 1,
      escapees: [{
        selector: "div.caption",
        position: "absolute",
        containingBlock: "(initial containing block)",
      }],
    }));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("outside the visual root");
  });

  test("reports a z-index specified on an unpositioned element", () => {
    const failures = evaluateRootContainment(positioning({
      zIndexOnUnpositioned: [{ selector: "div.layer", zIndex: "5" }],
    }));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("inert");
  });
});
