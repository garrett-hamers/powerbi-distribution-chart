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

    if (element !== root && style.position === "absolute") {
      absolutelyPositioned += 1;
    }

    if (element !== root) {
      if (unpainted) {
        exempt.unpainted += 1;
      } else if (clipPathHidden) {
        exempt.clipPathHidden += 1;
      } else if (inherited.scrollable) {
        // Reachable by scrolling, so it is not lost. The scroll container itself is
        // still measured; only its descendants are excused.
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
      visit(child, { unpainted, clipPathHidden, scrollable });
    }
  };

  visit(root, { unpainted: false, clipPathHidden: false, scrollable: false });

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
