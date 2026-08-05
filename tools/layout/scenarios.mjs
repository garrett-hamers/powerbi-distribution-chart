import { buildSampleMatrix, sampleName } from "../screenshots/sample-data.mjs";

/**
 * Data scenarios for the layout probe. Everything is derived from the same committed,
 * deterministic sample matrix the screenshots and the sample CSV use, so a probe run is
 * reproducible on any machine and never depends on network or clock.
 *
 * The scenarios exist to move the *layout* into its interesting corners - long category
 * names, many narrow categories, the highlight path that draws per-observation markers,
 * and the two degenerate states (empty and invalid) that render their own text.
 */

const VALUE_FORMAT = "0.0";

/**
 * Builds a grouped categorical DataView for an arbitrary set of category names.
 * Mirrors the shape produced by the screenshot sample data: distinct categories on the
 * axis, one series group per sample, one raw value per (category, sample) pair.
 */
function buildDataView({ categories, valuesFor, highlighted = new Set(), sampleCount }) {
  const { samples: allSamples } = buildSampleMatrix();
  const samples = sampleCount === undefined ? allSamples : allSamples.slice(0, sampleCount);

  const categoryColumn = {
    source: {
      displayName: "Production line",
      queryName: "Line.Production line",
      roles: { Category: true },
      type: { text: true },
    },
    values: [...categories],
    identity: categories.map((category) => ({ key: `category:${category}` })),
  };

  const groups = samples.map((sample, sampleIndex) => {
    const values = categories.map((category) => valuesFor(category, sampleIndex));
    const valueColumn = {
      source: {
        displayName: "Cycle time (s)",
        queryName: "Measurements.Cycle time (s)",
        roles: { Value: true },
        format: VALUE_FORMAT,
        groupName: sample,
        type: { numeric: true },
      },
      values,
    };
    if (highlighted.size > 0) {
      valueColumn.highlights = categories.map((category, categoryIndex) => (
        highlighted.has(category) ? values[categoryIndex] : null
      ));
    }
    return { name: sample, values: [valueColumn] };
  });

  const values = groups.flatMap((group) => group.values);
  values.grouped = () => groups;
  values.source = {
    displayName: "Run",
    queryName: "Runs.Run",
    roles: { Sample: true },
  };

  return {
    metadata: { columns: [categoryColumn.source, ...groups.map((group) => group.values[0].source)] },
    categorical: { categories: [categoryColumn], values },
  };
}

/** Wraps the committed matrix so any category name can borrow a real value series. */
function seriesReader(sourceNames) {
  const { valuesByCategory } = buildSampleMatrix();
  return (category, sampleIndex, fallbackIndex) => {
    const source = sourceNames[fallbackIndex % sourceNames.length];
    return valuesByCategory.get(source)[sampleIndex];
  };
}

function fromNames(names, options = {}) {
  const { categories: sourceNames } = buildSampleMatrix();
  const read = seriesReader(sourceNames);
  const indexOf = new Map(names.map((name, index) => [name, index]));
  return buildDataView({
    categories: names,
    valuesFor: (category, sampleIndex) => read(category, sampleIndex, indexOf.get(category) ?? 0),
    ...options,
  });
}

const LONG_LABELS = [
  "Northern Assembly Line Alpha - Shift 1",
  "Southern Assembly Line Bravo - Shift 2",
  "Eastern Finishing Cell Charlie - Shift 3",
  "Western Packaging Line Delta - Overnight",
  "Central Calibration Bench Echo - Weekend",
];

const ARABIC_LABELS = [
  "خط الإنتاج الشمالي - الوردية الأولى",
  "خط الإنتاج الجنوبي - الوردية الثانية",
  "خلية التشطيب الشرقية - الوردية الثالثة",
  "خط التغليف الغربي - الوردية الليلية",
  "منصة المعايرة المركزية - نهاية الأسبوع",
];

export const SCENARIOS = {
  standard: () => {
    const { categories } = buildSampleMatrix();
    return fromNames(categories);
  },
  "long-labels": () => fromNames(LONG_LABELS),
  "arabic-labels": () => fromNames(ARABIC_LABELS),
  "many-categories": () => fromNames(
    Array.from({ length: 12 }, (_unused, index) => `Line ${String.fromCharCode(65 + index)}`),
  ),
  "single-category": () => fromNames(["Line A"]),
  highlighted: () => {
    const { categories } = buildSampleMatrix();
    return fromNames(categories, { highlighted: new Set([categories[1]]) });
  },
  "small-sample": () => fromNames(["Line A", "Line B"], { sampleCount: 2 }),
  invalid: () => buildDataView({
    categories: ["Line A", "Line B"],
    valuesFor: () => null,
  }),
  empty: () => undefined,
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);

export { sampleName };
