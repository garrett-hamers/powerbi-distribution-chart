/**
 * The layout probe matrix.
 *
 * Tile sizes are the ones Power BI report authors actually produce: a full-width page
 * tile, a quarter-page card, a small KPI card, a dashboard tile and the smallest tile
 * the host will let you drag a visual down to. Small sizes are where clipping defects
 * live, so they are not optional.
 *
 * Feature states cover the toggles in `capabilities.json`. The *default* state matters
 * most - a defect in a feature that ships on by default is a defect every report hits
 * on day one - so every size is probed with no formatting objects set at all, exactly
 * as a freshly dropped visual is configured.
 */

export const TILE_SIZES = [
  { id: "1280x620", width: 1280, height: 620 },
  { id: "398x298", width: 398, height: 298 },
  { id: "258x198", width: 258, height: 198 },
  { id: "178x138", width: 178, height: 138 },
  { id: "80x80", width: 80, height: 80 },
];

export const FEATURE_STATES = [
  // No `objects` at all: showMean and showOutliers default to true, markerSize 5, labelSize 12.
  { id: "default", settings: undefined },
  // Every optional feature explicitly on, at the largest sizes the visual clamps to.
  { id: "maxed", settings: { showMean: true, showOutliers: true, markerSize: 12, labelSize: 18 } },
  // Optional chrome explicitly off - the data must still be there.
  { id: "features-off", settings: { showMean: false, showOutliers: false, markerSize: 3, labelSize: 8 } },
];

const size = (id) => TILE_SIZES.find((entry) => entry.id === id);

/**
 * @returns {{ id: string, scenario: string, feature: string, locale: string, highContrast: boolean, width: number, height: number }[]}
 */
export function buildCases() {
  const cases = [];
  const add = (scenario, feature, locale, tile, highContrast = false) => {
    cases.push({
      id: `${scenario}|${feature.id}|${locale}${highContrast ? "|hc" : ""}|${tile.id}`,
      scenario,
      feature: feature.id,
      settings: feature.settings,
      locale,
      highContrast,
      width: tile.width,
      height: tile.height,
    });
  };

  // Full cross-product for the shipping sample data: every size, every feature state,
  // both writing directions.
  for (const tile of TILE_SIZES) {
    for (const feature of FEATURE_STATES) {
      for (const locale of ["en-US", "ar-SA"]) {
        add("standard", feature, locale, tile);
      }
    }
  }

  // The remaining scenarios run in their default feature state across every size:
  // these exist to stress label length, category count and the degenerate states.
  const defaultFeature = FEATURE_STATES[0];
  for (const tile of TILE_SIZES) {
    for (const scenario of ["long-labels", "many-categories", "single-category", "highlighted", "small-sample", "invalid", "empty"]) {
      add(scenario, defaultFeature, "en-US", tile);
    }
    // Right-to-left with real Arabic labels: `direction: rtl` on an <svg> reinterprets
    // text anchoring, and the x coordinates are mirrored independently, so the two can
    // cancel or compound. Only a real engine can tell you which.
    add("arabic-labels", defaultFeature, "ar-SA", tile);
    add("long-labels", defaultFeature, "ar-SA", tile);
    // High contrast swaps fills for strokes and thickens them.
    add("standard", defaultFeature, "en-US", tile, true);
  }

  return cases;
}
