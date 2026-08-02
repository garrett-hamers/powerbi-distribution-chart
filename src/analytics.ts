import powerbi from "powerbi-visuals-api";

type SelectionId = powerbi.visuals.ISelectionId;

export const MAX_OBSERVATIONS = 30000;

export type DistributionState = "empty" | "invalid" | "small-sample" | "ready";

export interface RawObservation {
  category: string;
  sample: string;
  value: unknown;
  valueFormat?: string;
  tooltipValues?: Array<{ label: string; value: unknown; format?: string }>;
  selectionKey?: string;
  selectionId?: SelectionId;
  categorySelectionKey?: string;
  categorySelectionId?: SelectionId;
  selected?: boolean;
  highlighted?: boolean;
}

export interface ValidObservation {
  category: string;
  sample: string;
  value: number;
  valueFormat?: string;
  originalIndex: number;
  tooltipValues: Array<{ label: string; value: unknown; format?: string }>;
  selectionKey?: string;
  selectionId?: SelectionId;
  categorySelectionKey?: string;
  categorySelectionId?: SelectionId;
  selected: boolean;
  highlighted: boolean;
}

export interface Outlier {
  category: string;
  sample: string;
  value: number;
  valueFormat?: string;
  originalIndex: number;
  selectionKey?: string;
  selectionId?: SelectionId;
  categorySelectionKey?: string;
  categorySelectionId?: SelectionId;
  tooltipValues: Array<{ label: string; value: unknown; format?: string }>;
  selected: boolean;
  highlighted: boolean;
}

export interface DistributionStatistics {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  iqr: number;
  lowerFence: number;
  upperFence: number;
  lowerWhisker: number;
  upperWhisker: number;
}

export interface Distribution {
  category: string;
  observations: ValidObservation[];
  invalidCount: number;
  statistics?: DistributionStatistics;
  outliers: Outlier[];
  state: DistributionState;
  selectionKey?: string;
  categorySelectionKey?: string;
  categorySelectionId?: SelectionId;
  selected: boolean;
  highlighted: boolean;
  valueFormat?: string;
}

export interface ReductionDiagnostics {
  receivedRows: number;
  renderedRows: number;
  invalidRows: number;
  droppedRows: number;
  categoryCount: number;
  reachedWindowLimit: boolean;
  partialData: boolean;
  maxObservations: number;
  completeness: "not-asserted";
  message: string;
}

export interface DistributionModel {
  mode: "raw-observation";
  distributions: Distribution[];
  diagnostics: ReductionDiagnostics;
  hasHighlights: boolean;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function type7Quantile(sortedValues: readonly number[], probability: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const boundedProbability = Math.min(1, Math.max(0, probability));
  const h = 1 + (sortedValues.length - 1) * boundedProbability;
  const j = Math.floor(h);
  const g = h - j;
  const lowerIndex = Math.max(0, j - 1);
  const upperIndex = Math.min(sortedValues.length - 1, lowerIndex + 1);

  return sortedValues[lowerIndex] * (1 - g) + sortedValues[upperIndex] * g;
}

function calculateStatistics(values: readonly number[]): DistributionStatistics {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = type7Quantile(sorted, 0.25);
  const median = type7Quantile(sorted, 0.5);
  const q3 = type7Quantile(sorted, 0.75);
  const rawIqr = q3 - q1;
  const iqr = Number.isFinite(rawIqr) ? rawIqr : Number.MAX_VALUE;
  const rawLowerFence = q1 - 1.5 * iqr;
  const rawUpperFence = q3 + 1.5 * iqr;
  const lowerFence = Number.isFinite(rawLowerFence) ? rawLowerFence : -Number.MAX_VALUE;
  const upperFence = Number.isFinite(rawUpperFence) ? rawUpperFence : Number.MAX_VALUE;
  const lowerInliers = sorted.filter((value) => value >= lowerFence);
  const upperInliers = sorted.filter((value) => value <= upperFence);
  const rawMean = sorted.reduce((sum, value) => sum + value / sorted.length, 0);
  const mean = Number.isFinite(rawMean) ? rawMean : median;

  return {
    n: sorted.length,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1],
    mean,
    iqr,
    lowerFence,
    upperFence,
    lowerWhisker: lowerInliers[0],
    upperWhisker: upperInliers[upperInliers.length - 1],
  };
}

function getState(validCount: number, receivedCount: number): DistributionState {
  if (receivedCount === 0) {
    return "empty";
  }
  if (validCount === 0) {
    return "invalid";
  }
  if (validCount < 3) {
    return "small-sample";
  }
  return "ready";
}

export function buildDistributionModel(
  observations: readonly RawObservation[],
  options: {
    receivedRows?: number;
    maxObservations?: number;
  } = {},
): DistributionModel {
  const maxObservations = options.maxObservations ?? MAX_OBSERVATIONS;
  const receivedRows = options.receivedRows ?? observations.length;
  const boundedMaximum = Math.max(1, Math.floor(maxObservations));
  const grouped = new Map<string, {
    category: string;
    values: ValidObservation[];
    invalidCount: number;
    selectionKey?: string;
    categorySelectionKey?: string;
    categorySelectionId?: SelectionId;
    selected: boolean;
    highlighted: boolean;
  }>();
  let invalidRows = 0;
  let renderedRows = 0;
  let hasHighlights = false;

  observations.slice(0, boundedMaximum).forEach((observation, originalIndex) => {
    const category = observation.category || "(Blank category)";
    const groupKey = observation.categorySelectionKey ?? category;
    const group = grouped.get(groupKey) ?? {
      category,
      values: [],
      invalidCount: 0,
      selected: false,
      highlighted: false,
    };
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, group);
    }

    if (observation.selectionKey && !group.selectionKey) {
      group.selectionKey = observation.selectionKey;
    }
    if (observation.categorySelectionKey && !group.categorySelectionKey) {
      group.categorySelectionKey = observation.categorySelectionKey;
    }
    if (observation.categorySelectionId && !group.categorySelectionId) {
      group.categorySelectionId = observation.categorySelectionId;
    }
    group.selected ||= observation.selected ?? false;
    group.highlighted ||= observation.highlighted ?? false;
    hasHighlights ||= group.highlighted;

    if (!isFiniteNumber(observation.value)) {
      group.invalidCount += 1;
      invalidRows += 1;
      return;
    }

    const validObservation: ValidObservation = {
      category,
      sample: observation.sample || "(Blank sample)",
      value: observation.value,
      valueFormat: observation.valueFormat,
      originalIndex,
      tooltipValues: observation.tooltipValues ?? [],
      selectionKey: observation.selectionKey,
      selectionId: observation.selectionId,
      categorySelectionKey: observation.categorySelectionKey,
      categorySelectionId: observation.categorySelectionId,
      selected: observation.selected ?? false,
      highlighted: observation.highlighted ?? false,
    };
    group.values.push(validObservation);
    renderedRows += 1;
  });

  const distributions = [...grouped.values()].map((group) => {
    const statistics = group.values.length > 0 ? calculateStatistics(group.values.map((value) => value.value)) : undefined;
    const outliers = statistics
      ? group.values
        .filter((value) => value.value < statistics.lowerFence || value.value > statistics.upperFence)
        .map((value) => ({ ...value, tooltipValues: [...value.tooltipValues] }))
      : [];

    return {
      category: group.category,
      observations: group.values,
      invalidCount: group.invalidCount,
      statistics,
      outliers,
      state: getState(group.values.length, group.values.length + group.invalidCount),
      selectionKey: group.selectionKey,
      categorySelectionKey: group.categorySelectionKey,
      categorySelectionId: group.categorySelectionId,
      selected: group.selected,
      highlighted: group.highlighted,
      valueFormat: group.values.find((value) => value.valueFormat)?.valueFormat,
    };
  });

  const droppedRows = Math.max(0, receivedRows - boundedMaximum);
  const partialData = receivedRows >= boundedMaximum;
  const reachedWindowLimit = partialData || droppedRows > 0;
  const message = reachedWindowLimit
    ? "Partial data may be shown in the bounded raw-observation window. Completeness is not asserted."
    : "Completeness is not asserted in raw-observation mode.";

  return {
    mode: "raw-observation",
    distributions,
    hasHighlights,
    diagnostics: {
      receivedRows,
      renderedRows,
      invalidRows,
      droppedRows,
      categoryCount: distributions.length,
      reachedWindowLimit,
      partialData,
      maxObservations: boundedMaximum,
      completeness: "not-asserted",
      message,
    },
  };
}
