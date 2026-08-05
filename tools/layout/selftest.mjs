import {
  findScrollRegions,
  measureOverflow,
  measurePositioning,
  measureStickyOffsets,
  scrollRegionTo,
} from "./measure.mjs";

/**
 * Self-test fixtures for the layout rules.
 *
 * The Atlyn Distribution visual has no scroll containers and no sticky elements, so the
 * scroll walk and the sticky rules never fire against the real render. That is a perfectly
 * good result about the visual, and a terrible situation for the checks: machinery that
 * never runs is indistinguishable from machinery that cannot run, which is exactly how a
 * sibling repository ended up with scroll-time assertions that were dead weight over a
 * region with 24,467px of travel.
 *
 * So each rule is pointed at a DOM built specifically to break it, in the same real
 * browser engine, and required to produce the failure it exists to produce. The healthy
 * fixtures matter just as much: a rule that fires on correct layout is as useless as one
 * that never fires at all.
 *
 * These fixtures deliberately contain the defects. They are test input, not a template.
 */

const tile = document.getElementById("tile");
const host = document.getElementById("visual");

function reset({ width = 320, height = 200, rootPosition = "relative" } = {}) {
  tile.style.width = `${width}px`;
  tile.style.height = `${height}px`;
  host.replaceChildren();
  host.removeAttribute("style");
  host.style.position = rootPosition;
  host.style.overflow = "hidden";
  host.style.width = "100%";
  host.style.height = "100%";
  return host;
}

const element = (tag, styles = {}, text) => {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
};

/**
 * A sticky element inside a scrolling region that pins *outside* the visual root.
 *
 * At rest it sits in normal flow at the top of the panel, fully inside the root, and the
 * escape walk is clean. Once scrolled it pins to a negative offset, juts above the root's
 * top edge, and is clipped - and because it is pinned rather than flowing, no further
 * scrolling brings it back. This is content that is genuinely lost, and it is invisible
 * to any measurement taken at offset 0.
 */
function escapeOnlyUnderScroll() {
  const root = reset();
  const panel = element("div", {
    position: "absolute",
    inset: "0",
    overflowY: "auto",
    overflowX: "hidden",
  });
  panel.className = "selftest-panel";

  const pinned = element("div", {
    position: "sticky",
    // Pins 40px above the scrollport, which is 40px above the root's top edge.
    top: "-40px",
    height: "30px",
    background: "#eee",
  }, "pins above the visual root once scrolled");
  pinned.className = "selftest-pinned";
  panel.appendChild(pinned);
  panel.appendChild(element("div", { height: "1200px" }, "content"));

  root.appendChild(panel);
  return root;
}

/**
 * Sticky headers that all pin to the same offset and collapse onto one another.
 *
 * They are siblings in one scrolling container, so every one of them stays pinned for the
 * rest of the scroll rather than being released at the end of its own section. Once the
 * second reaches the top it lands on the first, and the third lands on both.
 */
function collapsedStickyHeaders() {
  const root = reset();
  const panel = element("div", {
    position: "absolute",
    inset: "0",
    overflowY: "auto",
  });
  panel.className = "selftest-panel";

  for (let index = 0; index < 3; index += 1) {
    const header = element("h3", {
      position: "sticky",
      // Every header pins to the same place: the collapse.
      top: "0px",
      margin: "0",
      height: "20px",
      background: "#ddd",
      zIndex: String(index + 1),
    }, `Header ${index + 1}`);
    header.className = `selftest-sticky-${index + 1}`;
    panel.appendChild(header);
    panel.appendChild(element("div", { height: "400px" }, `body ${index + 1}`));
  }

  root.appendChild(panel);
  return root;
}

/**
 * Sticky headers that pin to staggered offsets and stay distinct - the correct version of
 * the pattern above, and the negative control for the rule.
 */
function healthyStickyHeaders() {
  const root = reset();
  const panel = element("div", {
    position: "absolute",
    inset: "0",
    overflowY: "auto",
  });
  panel.className = "selftest-panel";

  for (let index = 0; index < 3; index += 1) {
    const header = element("h3", {
      position: "sticky",
      top: `${index * 20}px`,
      margin: "0",
      height: "20px",
      background: "#ddd",
      zIndex: String(index + 1),
    }, `Header ${index + 1}`);
    header.className = `selftest-sticky-${index + 1}`;
    panel.appendChild(header);
    panel.appendChild(element("div", { height: "400px" }, `body ${index + 1}`));
  }

  root.appendChild(panel);
  return root;
}

/**
 * A static root holding an absolutely positioned child. The child resolves against the
 * initial containing block, so it leaves the visual entirely and belongs to the page.
 */
function staticRootWithAbsoluteChild() {
  const root = reset({ rootPosition: "static" });
  const caption = element("div", {
    position: "absolute",
    top: "0",
    left: "0",
    width: "10px",
    height: "10px",
  }, "screen-reader caption");
  caption.className = "selftest-escapee";
  root.appendChild(caption);
  return root;
}

/** A z-index specified on an element that is not positioned, so it does nothing. */
function zIndexOnStaticElement() {
  const root = reset();
  const layer = element("div", { position: "static", zIndex: "5", height: "10px" }, "inert z-index");
  layer.className = "selftest-inert-layer";
  root.appendChild(layer);
  return root;
}

/** A declared scroll region that has stopped overflowing: the vacuous-fixture trap. */
function regionThatStoppedOverflowing() {
  const root = reset();
  const panel = element("div", {
    position: "absolute",
    inset: "0",
    overflowY: "auto",
  });
  panel.className = "selftest-panel";
  // Content shorter than the panel, so there is nowhere to scroll to.
  panel.appendChild(element("div", { height: "10px" }, "short"));
  root.appendChild(panel);
  return root;
}

/**
 * A row of sticky column headers, side by side, all pinned to the same offset.
 *
 * This is correct layout and must not be reported. Every sticky table header in existence
 * shares a `top` with its neighbours, so a rule that compares tops alone calls all of them
 * broken - which is how a rule earns its way into being ignored.
 */
function stickyColumnHeaders() {
  const root = reset();
  const panel = element("div", {
    position: "absolute",
    inset: "0",
    overflowY: "auto",
  });
  panel.className = "selftest-panel";

  const row = element("div", { display: "flex", width: "100%" });
  for (let index = 0; index < 3; index += 1) {
    const header = element("div", {
      position: "sticky",
      top: "0px",
      height: "18px",
      width: "80px",
      flex: "0 0 80px",
      background: "#ddd",
    }, `Col ${index + 1}`);
    header.className = `selftest-col-${index + 1}`;
    row.appendChild(header);
  }
  panel.appendChild(row);
  panel.appendChild(element("div", { height: "1200px" }, "rows"));

  root.appendChild(panel);
  return root;
}

const FIXTURES = {
  "escape-only-under-scroll": escapeOnlyUnderScroll,
  "collapsed-sticky": collapsedStickyHeaders,
  "healthy-sticky": healthyStickyHeaders,
  "sticky-column-headers": stickyColumnHeaders,
  "static-root-absolute-child": staticRootWithAbsoluteChild,
  "zindex-on-static": zIndexOnStaticElement,
  "region-stopped-overflowing": regionThatStoppedOverflowing,
};

/**
 * Builds a fixture and returns its raw measurements. All judgement happens in Node, in
 * `scripts/layout-selftest.mjs`, using the same unit-tested rules the real probe applies.
 *
 * @param {{ fixture: string }} spec
 */
function run(spec) {
  const build = FIXTURES[spec.fixture];
  if (!build) {
    throw new Error(`Unknown self-test fixture "${spec.fixture}".`);
  }

  const root = build();
  void root.getBoundingClientRect();

  return {
    fixture: spec.fixture,
    atRest: measureOverflow(root, { view: window }),
    positioning: measurePositioning(root, { view: window }),
    scrollRegions: findScrollRegions(root, { view: window })
      .map(({ element: _element, ...rest }) => rest),
    sticky: measureStickyOffsets(root, { view: window }),
  };
}

window.__atlynSelfTest = {
  run: (spec) => {
    try {
      return { ok: true, result: run(spec) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) };
    }
  },
  scrollTo: (selector, offset) => {
    try {
      return { ok: true, result: scrollRegionTo(host, selector, offset, window) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) };
    }
  },
};

document.documentElement.dataset.selftestReady = "true";
