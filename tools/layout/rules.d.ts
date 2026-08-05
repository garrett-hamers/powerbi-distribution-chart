/**
 * Types for the layout rules.
 *
 * The rules are plain CommonJS so the ESM tooling in `scripts/` and the Jest suite can
 * share one implementation - the same arrangement `scripts/normalize-pbiviz.js` already
 * uses. These declarations exist so the unit tests can drive them under `strict`.
 */

export interface ScrollRegionMeasurement {
  selector: string;
  scrollHeight: number;
  clientHeight: number;
  maxScrollTop: number;
  scrollWidth?: number;
  clientWidth?: number;
  maxScrollLeft?: number;
  overflowX?: string;
  overflowY?: string;
}

export interface ScrollExpectation {
  selector: string;
  minScrollTop?: number;
}

export interface StickyMeasurement {
  selector: string;
  position: string;
  top: number;
  height: number;
  left?: number;
  width?: number;
  zIndex?: string | null;
  text?: string;
}

/**
 * A stacking claim needs only identity, whether the element is positioned, and its
 * z-index. Geometry is deliberately not part of it: the whole point of the rule is that
 * z-index is inert without positioning, which is a question about `position`, not boxes.
 */
export interface StackingMeasurement {
  selector: string;
  position: string;
  zIndex?: string | null;
}

export interface PositionedMeasurement {
  selector: string;
  position: string;
  zIndex?: string | null;
  containingBlock?: string;
  containingBlockIsRoot?: boolean;
  containedByRoot?: boolean;
}

export interface PositioningMeasurement {
  rootPosition: string;
  rootIsPositioned: boolean;
  absoluteCount: number;
  escapees: PositionedMeasurement[];
  zIndexOnUnpositioned: { selector: string; zIndex: string }[];
}

declare const rules: {
  scrollOffsetsFor(maxScrollTop: number): number[];
  evaluateScrollExpectations(
    regions: ScrollRegionMeasurement[],
    expectations?: ScrollExpectation[],
  ): string[];
  evaluateStickyOffsets(
    samples: StickyMeasurement[],
    options?: { tolerance?: number },
  ): string[];
  evaluateStackingOrder(
    samples: StackingMeasurement[],
    options?: { requiredPosition?: string },
  ): string[];
  evaluateRootContainment(positioning: PositioningMeasurement): string[];
};

export default rules;
