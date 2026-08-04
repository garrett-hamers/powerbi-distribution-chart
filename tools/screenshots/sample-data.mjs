/**
 * Deterministic, fully offline sample data for the Atlyn Distribution submission
 * assets. The same module feeds both the browser screenshot harness and the
 * checked-in sample CSV, so the committed screenshots and the committed dataset
 * can never drift apart.
 *
 * Scenario: cycle time (seconds) measured on five production lines across forty
 * repeated production runs. Category = production line, Sample = run,
 * Value = cycle time.
 */

export const CATEGORY_DISPLAY_NAME = "Production line";
export const SAMPLE_DISPLAY_NAME = "Run";
export const VALUE_DISPLAY_NAME = "Cycle time (s)";
export const VALUE_FORMAT = "0.0";
export const SAMPLE_COUNT = 40;

/**
 * `spread` is the target standard deviation in seconds. `injected` values are
 * deliberate real observations placed at fixed run indexes so the screenshots
 * always show the Tukey outlier and zero-IQR behaviour the visual is built for.
 */
export const CATEGORY_PROFILES = [
  { name: "Line A", seed: 20260101, mean: 42, spread: 3, injected: {} },
  { name: "Line B", seed: 20260202, mean: 47, spread: 6, injected: {} },
  { name: "Line C", seed: 20260303, mean: 44, spread: 4, injected: { 11: 60.5, 29: 63.2 } },
  { name: "Line D", seed: 20260404, mean: 39, spread: 2.5, injected: { 6: 29.8 } },
  { name: "Line E", seed: 20260505, mean: 45, spread: 0, injected: { 22: 55 } },
];

export const CATEGORIES = CATEGORY_PROFILES.map((profile) => profile.name);

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Bates(4) transform: deterministic, bounded, and close enough to normal. */
function standardScore(random) {
  return (random() + random() + random() + random() - 2) * Math.sqrt(3);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function sampleName(index) {
  return `Run ${String(index + 1).padStart(2, "0")}`;
}

/**
 * @returns {{ categories: string[], samples: string[], valuesByCategory: Map<string, number[]> }}
 */
export function buildSampleMatrix() {
  const samples = Array.from({ length: SAMPLE_COUNT }, (_unused, index) => sampleName(index));
  const valuesByCategory = new Map();

  CATEGORY_PROFILES.forEach((profile) => {
    const random = createRandom(profile.seed);
    const values = samples.map((_unused, index) => {
      const score = standardScore(random);
      const injected = profile.injected[index];
      return injected === undefined ? round1(profile.mean + score * profile.spread) : injected;
    });
    valuesByCategory.set(profile.name, values);
  });

  return { categories: CATEGORIES, samples, valuesByCategory };
}

/** Flat row form used by the CSV export. */
export function buildSampleRows() {
  const { categories, samples, valuesByCategory } = buildSampleMatrix();
  const rows = [];
  categories.forEach((category) => {
    const values = valuesByCategory.get(category);
    samples.forEach((sample, index) => {
      rows.push({ category, sample, value: values[index] });
    });
  });
  return rows;
}

/**
 * Builds the grouped categorical DataView the visual consumes in a real host:
 * distinct categories on the axis, one series group per sample, one raw value
 * per (category, sample) pair.
 *
 * @param {{ categories?: string[], highlightedCategories?: string[] }} [options]
 */
export function buildDataView(options = {}) {
  const { categories: allCategories, samples, valuesByCategory } = buildSampleMatrix();
  const categories = options.categories ?? allCategories;
  const highlighted = new Set(options.highlightedCategories ?? []);

  const categoryColumn = {
    source: {
      displayName: CATEGORY_DISPLAY_NAME,
      queryName: `Line.${CATEGORY_DISPLAY_NAME}`,
      roles: { Category: true },
      type: { text: true },
    },
    values: [...categories],
    identity: categories.map((category) => ({ key: `category:${category}` })),
  };

  const groups = samples.map((sample, sampleIndex) => {
    const values = categories.map((category) => valuesByCategory.get(category)[sampleIndex]);
    const valueColumn = {
      source: {
        displayName: VALUE_DISPLAY_NAME,
        queryName: `Measurements.${VALUE_DISPLAY_NAME}`,
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
    displayName: SAMPLE_DISPLAY_NAME,
    queryName: `Runs.${SAMPLE_DISPLAY_NAME}`,
    roles: { Sample: true },
  };

  return {
    metadata: {
      columns: [categoryColumn.source, ...groups.map((group) => group.values[0].source)],
    },
    categorical: { categories: [categoryColumn], values },
  };
}
