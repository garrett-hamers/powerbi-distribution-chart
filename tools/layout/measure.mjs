/**
 * Layout measurement for the Atlyn Distribution layout probe.
 *
 * A Power BI custom visual lives inside a host tile that clips with `overflow: hidden`.
 * Content pushed outside that tile does not scroll and leaves no trace - it is simply
 * gone, and no stylesheet assertion or JSDOM test can see it, because JSDOM has no
 * layout engine and reports every rectangle as zero. Everything here therefore runs in
 * a real browser and reads real `getBoundingClientRect()` geometry.
 *
 * The check is deliberately generic: walk every element under the visual root and flag
 * any box that escapes the root's box. Three exemptions, each of them a genuine
 * "the user can still get at this" case rather than a convenience:
 *
 *   - descendants of a real scroll container (`overflow: auto|scroll`) can be reached
 *     by scrolling, so they are not lost;
 *   - anything not painted at all (`display: none`, `visibility: hidden`, zero opacity);
 *   - anything clipped to zero area by `clip-path`, which is the standard
 *     screen-reader-only idiom - it is deliberately invisible, not accidentally lost.
 *
 * Exemptions are counted and reported rather than silently dropped, so a probe run can
 * never hide a regression behind a growing pile of "not my problem" elements.
 *
 * The scroll-container exemption carries an obligation: content reachable by scrolling is
 * only genuinely reachable if something actually scrolls to it. This module therefore
 * exposes `scrollRegionTo`, and the Node driver walks every region through its full travel
 * and re-measures at each stop.
 *
 * Measurement lives here; judgement lives in `rules.js`, which runs in Node and is unit
 * tested. Keeping the two apart means every rule can be driven with deliberately bad
 * numbers instead of only ever seeing whatever the real visual happens to render.
 */

const TOLERANCE_PX = 0.5;

const round = (value) => Math.round(value * 100) / 100;

/**
 * Expands the `inset()` shorthand (margin-style: 1, 2, 3 or 4 values) and reports the
 * area the element still paints. `overflow` is inert on `display: table` boxes, so the
 * screen-reader-only idiom in this visual leans on `clip-path` - which means the probe
 * has to understand `clip-path` to tell "deliberately invisible" from "accidentally
 * lost".
 */
export function insetClipArea(clipPath, width, height) {
  if (typeof clipPath !== "string") {
    return null;
  }
  const match = /^inset\(([^)]*)\)/i.exec(clipPath.trim());
  if (!match) {
    return null;
  }

  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  const roundIndex = tokens.findIndex((token) => /^round$/i.test(token));
  const sides = (roundIndex === -1 ? tokens : tokens.slice(0, roundIndex)).slice(0, 4);
  if (sides.length === 0) {
    return null;
  }

  const [first, second = first, third = first, fourth = second] = sides;
  const toPixels = (token, basis) => {
    const numeric = Number.parseFloat(token);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return token.trim().endsWith("%") ? (numeric / 100) * basis : numeric;
  };

  return {
    width: width - toPixels(fourth, width) - toPixels(second, width),
    height: height - toPixels(first, height) - toPixels(third, height),
  };
}

function describe(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const rawClass = typeof element.className === "string"
    ? element.className
    : (element.className?.baseVal ?? "");
  const classes = rawClass.trim() ? `.${rawClass.trim().split(/\s+/).join(".")}` : "";
  return `${tag}${id}${classes}`;
}

function intersection(rect, clipRect) {
  const left = Math.max(rect.left, clipRect.left);
  const top = Math.max(rect.top, clipRect.top);
  const right = Math.min(rect.right, clipRect.right);
  const bottom = Math.min(rect.bottom, clipRect.bottom);
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Measures every element under `root` against the root's clipped box.
 *
 * @param {HTMLElement} root the element the host handed the visual
 * @param {{ view?: Window }} [options]
 */
export function measureOverflow(root, options = {}) {
  const view = options.view ?? globalThis;
  const rootRect = root.getBoundingClientRect();

  const overflows = [];
  const exempt = { scrollable: 0, unpainted: 0, clipPathHidden: 0, zeroArea: 0 };
  const clipPathRoots = new Set();
  const scrollRoots = new Set();
  let absolutelyPositioned = 0;
  let inspected = 0;

  const visit = (element, inherited) => {
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    const unpainted = inherited.unpainted
      || style.display === "none"
      || style.visibility === "hidden"
      || style.visibility === "collapse"
      || Number.parseFloat(style.opacity) === 0;

    const clipArea = insetClipArea(style.clipPath, rect.width, rect.height);
    const selfClipped = clipArea !== null && (clipArea.width <= 0 || clipArea.height <= 0);
    const clipPathHidden = inherited.clipPathHidden || selfClipped;
    if (selfClipped && !inherited.clipPathHidden) {
      // Record where each screen-reader-only subtree starts, so the caller can check the
      // exemption is being spent on the elements it was meant for and not quietly
      // swallowing a real defect.
      clipPathRoots.add(describe(element));
    }

    const selfScrollable = ["auto", "scroll"].includes(style.overflowX)
      || ["auto", "scroll"].includes(style.overflowY);
    const scrollable = inherited.scrollable || selfScrollable;
    if (selfScrollable && !inherited.scrollable) {
      scrollRoots.add(describe(element));
    }
    const scrollContainer = selfScrollable && !inherited.scrollContainer
      ? element
      : inherited.scrollContainer;

    if (element !== root && style.position === "absolute") {
      absolutelyPositioned += 1;
    }

    /*
      The scroll exemption is justified by "the user can scroll to it", which is only true
      of content that actually scrolls with the container.

      A `sticky` element pins and stops moving; a `fixed` one never moved to begin with;
      an `absolute` one whose containing block sits outside the scroll container is
      likewise unaffected by that container's scrolling. If any of those is painted outside
      the visual root, no amount of scrolling brings it back - it is clipped exactly like
      any other escapee. Excusing them wholesale is how a sticky-header collapse walks
      straight through an overflow walk unnoticed.
    */
    const scrollsWithContainer = (() => {
      if (style.position === "sticky" || style.position === "fixed") {
        return false;
      }
      if (style.position === "absolute" && inherited.scrollContainer) {
        const block = containingBlockFor(element, style.position, view);
        return block !== null && inherited.scrollContainer.contains(block);
      }
      return true;
    })();

    if (element !== root) {
      if (unpainted) {
        exempt.unpainted += 1;
      } else if (clipPathHidden) {
        exempt.clipPathHidden += 1;
      } else if (inherited.scrollable && scrollsWithContainer) {
        // Reachable by scrolling, so it is not lost. The scroll container itself is
        // still measured; only the descendants that genuinely scroll are excused.
        exempt.scrollable += 1;
      } else if (rect.width === 0 && rect.height === 0) {
        // Non-rendered SVG containers (defs, empty groups) and the like.
        exempt.zeroArea += 1;
      } else {
        inspected += 1;
        const escapeLeft = rootRect.left - rect.left;
        const escapeTop = rootRect.top - rect.top;
        const escapeRight = rect.right - rootRect.right;
        const escapeBottom = rect.bottom - rootRect.bottom;
        const escape = Math.max(escapeLeft, escapeTop, escapeRight, escapeBottom);
        if (escape > TOLERANCE_PX) {
          const visible = intersection(rect, rootRect);
          overflows.push({
            selector: describe(element),
            escape: round(escape),
            left: round(escapeLeft),
            top: round(escapeTop),
            right: round(escapeRight),
            bottom: round(escapeBottom),
            rect: {
              x: round(rect.left - rootRect.left),
              y: round(rect.top - rootRect.top),
              width: round(rect.width),
              height: round(rect.height),
            },
            visible: { width: round(visible.width), height: round(visible.height) },
            text: (element.textContent ?? "").trim().slice(0, 80),
          });
        }
      }
    }

    for (const child of element.children) {
      visit(child, { unpainted, clipPathHidden, scrollable, scrollContainer });
    }
  };

  visit(root, { unpainted: false, clipPathHidden: false, scrollable: false, scrollContainer: null });

  overflows.sort((left, right) => right.escape - left.escape);

  return {
    root: { width: round(rootRect.width), height: round(rootRect.height) },
    // An absolutely positioned child of a `position: static` root resolves against the
    // initial containing block, escaping the root's `overflow: hidden` entirely and
    // belonging to the page rather than the visual. Report the root's position alongside
    // the count so the caller can reject that arrangement outright.
    rootPosition: view.getComputedStyle(root).position,
    absolutelyPositioned,
    inspected,
    exempt,
    clipPathRoots: [...clipPathRoots],
    scrollRoots: [...scrollRoots],
    overflowCount: overflows.length,
    maxEscape: overflows.length > 0 ? overflows[0].escape : 0,
    overflows,
  };
}

/**
 * Resolves the element that actually forms the containing block for `element`.
 *
 * This is the diagnostic behind one of the two defect classes this addition exists to
 * catch. An absolutely positioned element resolves against its nearest *positioned*
 * ancestor - but if no such ancestor exists it resolves against the **initial containing
 * block**, escaping the visual root's `overflow: hidden` entirely and belonging to the
 * page rather than to the visual. A sibling repository shipped exactly that: a
 * screen-reader caption whose `offsetParent` was `<body>`.
 *
 * `offsetParent` is the usual shortcut but it is not reliable here - it is null for
 * `position: fixed` and for anything inside a `display: none` subtree, and this visual
 * has both. So the ancestor chain is walked directly, honouring the layout-inducing
 * properties that also establish a containing block for positioned descendants.
 *
 * @returns the containing block ancestor, or null when it is the initial containing block
 */
export function containingBlockFor(element, position, view) {
  if (position === "static" || position === "relative" || position === "sticky") {
    // These resolve against the parent's content box, not against a positioned ancestor.
    return element.parentElement;
  }

  // transform, filter, perspective, will-change and paint/layout containment establish a
  // containing block even for `position: fixed`, which otherwise resolves to the viewport.
  const establishesForFixed = (style) => (style.transform && style.transform !== "none")
    || (style.filter && style.filter !== "none")
    || (style.perspective && style.perspective !== "none")
    || (style.willChange ?? "").split(",").some((token) => ["transform", "filter", "perspective"].includes(token.trim()))
    || ["paint", "layout", "strict", "content"].some((token) => (style.contain ?? "").includes(token));

  let ancestor = element.parentElement;
  while (ancestor) {
    const style = view.getComputedStyle(ancestor);
    const establishes = position === "fixed"
      ? establishesForFixed(style)
      : style.position !== "static" || establishesForFixed(style);
    if (establishes) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

/**
 * Positioning triage.
 *
 * The cheapest available check for two whole defect classes, run before anything is
 * scrolled or measured for overflow:
 *
 *   - a root computing `static` while holding absolutely positioned descendants means
 *     those descendants resolve against the initial containing block and leave the visual;
 *   - `position: sticky` inside a genuinely scrolling region is the header-pinning bug,
 *     which no at-rest assertion can see.
 *
 * Also records any z-index specified on an element that is not positioned at all.
 * `getComputedStyle().zIndex` returns the *specified* value regardless of position, so a
 * stacking comparison can read a confident-looking order out of a stacking context that
 * does not exist.
 */
export function measurePositioning(root, options = {}) {
  const view = options.view ?? globalThis;
  const rootStyle = view.getComputedStyle(root);

  const counts = { static: 0, relative: 0, absolute: 0, fixed: 0, sticky: 0 };
  const positioned = [];
  const escapees = [];
  const zIndexOnUnpositioned = [];

  const visit = (element) => {
    if (element !== root) {
      const style = view.getComputedStyle(element);
      const position = style.position;
      counts[position] = (counts[position] ?? 0) + 1;

      const zIndex = style.zIndex;
      const hasZIndex = zIndex !== "auto" && zIndex !== "";
      if (hasZIndex && position === "static") {
        zIndexOnUnpositioned.push({ selector: describe(element), zIndex });
      }

      if (position !== "static" && position !== "relative") {
        const block = containingBlockFor(element, position, view);
        const containedByRoot = block !== null && (block === root || root.contains(block));
        const entry = {
          selector: describe(element),
          position,
          zIndex: hasZIndex ? zIndex : null,
          containingBlock: block === null ? "(initial containing block)" : describe(block),
          containingBlockIsRoot: block === root,
          containedByRoot,
        };
        positioned.push(entry);
        if (!containedByRoot) {
          escapees.push(entry);
        }
      }
    }
    for (const child of element.children) {
      visit(child);
    }
  };

  visit(root);

  return {
    rootPosition: rootStyle.position,
    // Both halves are reported rather than just a verdict: an unpositioned root is only a
    // defect in combination with an absolutely positioned descendant.
    rootIsPositioned: rootStyle.position !== "static",
    counts,
    positioned,
    escapees,
    zIndexOnUnpositioned,
    stickyCount: counts.sticky ?? 0,
    fixedCount: counts.fixed ?? 0,
    absoluteCount: counts.absolute ?? 0,
  };
}

/**
 * Finds every real scroll container under `root` and how far it can actually scroll.
 *
 * A container reporting `maxScrollTop: 0` is not scrolling whatever its `overflow` says,
 * and a probe that detects a scroll container without ever scrolling it leaves every
 * scroll-time assertion as dead weight - a sibling repository had precisely that, and
 * once it started scrolling it found a region with 24,467px of travel.
 */
export function findScrollRegions(root, options = {}) {
  const view = options.view ?? globalThis;
  const regions = [];

  const visit = (element) => {
    const style = view.getComputedStyle(element);
    const scrollableY = ["auto", "scroll"].includes(style.overflowY);
    const scrollableX = ["auto", "scroll"].includes(style.overflowX);
    if (scrollableY || scrollableX) {
      regions.push({
        selector: describe(element),
        element,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
        maxScrollLeft: Math.max(0, element.scrollWidth - element.clientWidth),
      });
    }
    for (const child of element.children) {
      visit(child);
    }
  };

  visit(root);
  return regions;
}

/**
 * Records where every sticky element has landed, relative to the root, so the caller can
 * check they stay distinct under scroll instead of collapsing onto one another.
 */
export function measureStickyOffsets(root, options = {}) {
  const view = options.view ?? globalThis;
  const rootRect = root.getBoundingClientRect();
  const samples = [];

  const visit = (element) => {
    const style = view.getComputedStyle(element);
    if (style.position === "sticky") {
      const rect = element.getBoundingClientRect();
      samples.push({
        selector: describe(element),
        position: style.position,
        top: round(rect.top - rootRect.top),
        left: round(rect.left - rootRect.left),
        height: round(rect.height),
        width: round(rect.width),
        zIndex: style.zIndex,
        text: (element.textContent ?? "").trim().slice(0, 40),
      });
    }
    for (const child of element.children) {
      visit(child);
    }
  };

  visit(root);
  return samples;
}

/**
 * Scrolls one region to `offset` and re-measures everything that scrolling can change.
 *
 * The offsets to visit are chosen in Node by `scrollOffsetsFor`, so the schedule itself is
 * unit tested rather than hidden in the page. What is returned is `applied`, the offset
 * the engine actually settled on - a region that cannot travel clamps silently, and
 * recording the requested value would make a walk look like it covered ground it never
 * reached.
 */
export function scrollRegionTo(root, selector, offset, view = globalThis) {
  const region = findScrollRegions(root, { view }).find((candidate) => candidate.selector === selector);
  if (!region) {
    return { found: false, selector, requested: offset };
  }

  region.element.scrollTop = offset;
  const applied = region.element.scrollTop;
  void region.element.getBoundingClientRect();

  return {
    found: true,
    selector,
    requested: offset,
    applied,
    overflow: measureOverflow(root, { view }),
    sticky: measureStickyOffsets(root, { view }),
  };
}

/**
 * Measures how much of the visual's *data* actually lands inside the tile. Chrome may
 * legitimately be dropped when a tile gets small; boxes, category labels and the
 * accessible summary may not. This is the "degrade chrome, never data" invariant
 * expressed as numbers.
 *
 * @param {HTMLElement} root
 */
export function measureDataSurvival(root) {
  const rootRect = root.getBoundingClientRect();

  const survey = (elements) => {
    let fullyVisible = 0;
    let partiallyVisible = 0;
    let invisible = 0;
    let minVisibleWidth = Number.POSITIVE_INFINITY;
    let minVisibleHeight = Number.POSITIVE_INFINITY;

    elements.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const visible = intersection(rect, rootRect);
      minVisibleWidth = Math.min(minVisibleWidth, visible.width);
      minVisibleHeight = Math.min(minVisibleHeight, visible.height);
      // A vertical whisker is legitimately zero pixels wide, so "visible" has to mean
      // "has extent in the dimensions where extent was asked for", not "has area".
      const clippedAway = (rect.width > 0 && visible.width <= 0)
        || (rect.height > 0 && visible.height <= 0);
      const fullyInside = visible.width >= rect.width - 0.5 && visible.height >= rect.height - 0.5;
      if (clippedAway) {
        invisible += 1;
      } else if (fullyInside) {
        fullyVisible += 1;
      } else {
        partiallyVisible += 1;
      }
    });

    return {
      total: elements.length,
      fullyVisible,
      partiallyVisible,
      invisible,
      minVisibleWidth: elements.length > 0 ? round(minVisibleWidth) : 0,
      minVisibleHeight: elements.length > 0 ? round(minVisibleHeight) : 0,
    };
  };

  const query = (selector) => Array.from(root.querySelectorAll(selector));

  return {
    boxes: survey(query("svg .atlyn-box")),
    categories: survey(query("svg .atlyn-category")),
    categoryLabels: survey(query("svg .atlyn-category > text")),
    outliers: survey(query("svg .atlyn-outlier")),
    summaryRows: root.querySelectorAll("table.atlyn-summary tbody tr").length,
    summaryCells: root.querySelectorAll("table.atlyn-summary tbody td").length,
  };
}
