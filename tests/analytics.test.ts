import {
  MAX_OBSERVATIONS,
  RawObservation,
  buildDistributionModel,
  isFiniteNumber,
  type7Quantile,
} from "../src/analytics";

const observation = (category: string, value: unknown, sample = `${category}-${String(value)}`): RawObservation => ({
  category,
  sample,
  value,
});

describe("Atlyn distribution statistics", () => {
  test("uses Hyndman-Fan Type 7 quartiles", () => {
    expect(type7Quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(type7Quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(type7Quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
  });

  test("retains zero, negative, and duplicate outlier observations", () => {
    const model = buildDistributionModel([
      observation("A", -10, "low"),
      observation("A", 0, "zero"),
      observation("A", 1, "one"),
      observation("A", 2, "two"),
      observation("A", 3, "three"),
      observation("A", 4, "four"),
      observation("A", 5, "five"),
      observation("A", 20, "high-1"),
      observation("A", 20, "high-2"),
    ]);
    const distribution = model.distributions[0];

    expect(distribution.statistics?.min).toBe(-10);
    expect(distribution.statistics?.max).toBe(20);
    expect(distribution.outliers).toHaveLength(3);
    expect(distribution.outliers.map((item) => item.sample)).toEqual(["low", "high-1", "high-2"]);
  });

  test("does not call equal-valued samples outliers when IQR is zero", () => {
    const model = buildDistributionModel([
      observation("A", 4, "one"),
      observation("A", 4, "two"),
      observation("A", 4, "three"),
    ]);
    expect(model.distributions[0].statistics?.iqr).toBe(0);
    expect(model.distributions[0].outliers).toHaveLength(0);
  });

  test("handles one and two valid observations with truthful small-sample state", () => {
    const one = buildDistributionModel([observation("one", 7)]).distributions[0];
    const two = buildDistributionModel([observation("two", 2), observation("two", 8)]).distributions[0];

    expect(one.state).toBe("small-sample");
    expect(one.statistics).toMatchObject({
      n: 1,
      min: 7,
      q1: 7,
      median: 7,
      q3: 7,
      max: 7,
    });
    expect(two.statistics).toMatchObject({
      n: 2,
      q1: 3.5,
      median: 5,
      q3: 6.5,
    });
  });

  test("separates invalid values from valid values and preserves empty input", () => {
    const model = buildDistributionModel([
      observation("valid", 1),
      observation("valid", null),
      observation("valid", Number.POSITIVE_INFINITY),
      observation("invalid", "not numeric"),
      observation("invalid", Number.NaN),
    ]);

    expect(model.diagnostics.invalidRows).toBe(4);
    expect(model.distributions.find((item) => item.category === "valid")?.state).toBe("small-sample");
    expect(model.distributions.find((item) => item.category === "invalid")?.state).toBe("invalid");
    expect(buildDistributionModel([]).distributions).toHaveLength(0);
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(Infinity)).toBe(false);
  });

  test("reports bounded reduction without claiming completeness", () => {
    const observations = Array.from({ length: MAX_OBSERVATIONS + 5 }, (_, index) => observation("A", index));
    const model = buildDistributionModel(observations);

    expect(model.diagnostics.receivedRows).toBe(MAX_OBSERVATIONS + 5);
    expect(model.diagnostics.renderedRows).toBe(MAX_OBSERVATIONS);
    expect(model.diagnostics.reachedWindowLimit).toBe(true);
    expect(model.diagnostics.partialData).toBe(true);
    expect(model.diagnostics.droppedRows).toBe(5);
    expect(model.diagnostics.maxObservations).toBe(MAX_OBSERVATIONS);
    expect(model.diagnostics.completeness).toBe("not-asserted");
    expect(model.diagnostics.message).toContain("Completeness is not asserted");
  });

  test("marks a full bounded window as potentially partial without claiming completeness", () => {
    const observations = Array.from({ length: MAX_OBSERVATIONS }, (_, index) => observation("A", index));
    const model = buildDistributionModel(observations);

    expect(model.diagnostics.receivedRows).toBe(MAX_OBSERVATIONS);
    expect(model.diagnostics.renderedRows).toBe(MAX_OBSERVATIONS);
    expect(model.diagnostics.droppedRows).toBe(0);
    expect(model.diagnostics.partialData).toBe(true);
    expect(model.diagnostics.message).toContain("bounded raw-observation window");
  });

  test("keeps categories independent and retains selection/highlight metadata", () => {
    const selectionId = { getKey: () => "A:s1" } as never;
    const model = buildDistributionModel([
      { ...observation("A", 1, "s1"), selectionId, selected: true, highlighted: true },
      { ...observation("B", 3, "s2"), selectionId },
    ]);

    expect(model.distributions).toHaveLength(2);
    expect(model.hasHighlights).toBe(true);
    expect(model.distributions[0].observations[0].selectionId).toBe(selectionId);
    expect(model.distributions[0].observations[0].selected).toBe(true);
  });
});
