import powerbi from "powerbi-visuals-api";
import { buildModelFromDataView, extractObservations } from "../src/dataView";

function makeCategoricalDataView(): powerbi.DataView {
  const categoryColumn = {
    source: { displayName: "Category", roles: { Category: true } },
    values: ["North", "South"],
    identity: [{}, {}],
  };
  const valueColumn = {
    source: { displayName: "Value", roles: { Value: true }, format: "$0.00" },
    values: [10, 20],
    highlights: [10, null],
  };
  const tooltipColumn = {
    source: { displayName: "Order", roles: { Tooltips: true }, format: "0" },
    values: [1001, 1002],
  };
  const groups = [{
    name: "Sample 1",
    values: [valueColumn, tooltipColumn],
    identity: {},
  }];
  const values = [valueColumn, tooltipColumn] as unknown as powerbi.DataViewValueColumns;
  values.grouped = () => groups as unknown as powerbi.DataViewValueColumnGroup[];
  return {
    categorical: {
      categories: [categoryColumn],
      values,
    },
  } as unknown as powerbi.DataView;
}

describe("Power BI raw-observation contract", () => {
  test("extracts Category × Sample × Value rows and formatted tooltip fields", () => {
    const dataView = makeCategoricalDataView();
    const observations = extractObservations(dataView, {
      selectedKeys: new Set(["North:Sample 1"]),
      createSelectionId: (_category, index, _values, group) => ({
        getKey: () => `${index === 0 ? "North" : "South"}:${String(group?.name)}`,
      } as unknown as powerbi.visuals.ISelectionId),
    });
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      category: "North",
      sample: "Sample 1",
      value: 10,
      highlighted: true,
      selected: true,
    });
    expect(observations[0].tooltipValues).toEqual([
      { label: "Order", value: 1001, format: "0" },
    ]);
    expect(observations[1].highlighted).toBe(false);
  });

  test("builds an invalid state rather than inferring a distribution from an aggregate", () => {
    const valueColumn = {
      source: { displayName: "Value", roles: { Value: true } },
      values: [null as powerbi.PrimitiveValue],
    };
    const values = [valueColumn] as unknown as powerbi.DataViewValueColumns;
    values.grouped = () => [{
      name: "Sample 1",
      values: [valueColumn],
    }];
    const dataView = {
      categorical: {
        categories: [{
          source: { displayName: "Category", roles: { Category: true } },
          values: ["Only category"],
        }],
        values,
      },
    } as unknown as powerbi.DataView;
    const model = buildModelFromDataView(dataView);

    expect(model.mode).toBe("raw-observation");
    expect(model.distributions[0].state).toBe("invalid");
    expect(model.distributions[0].statistics).toBeUndefined();
  });

  test("returns no rows when required roles are absent", () => {
    const dataView = {
      categorical: {
        categories: [{
          source: { displayName: "Category", roles: { Category: true } },
          values: ["A"],
        }],
        values: [],
      },
    } as unknown as powerbi.DataView;
    expect(extractObservations(dataView)).toEqual([]);
  });

  test("does not infer raw observations from an ungrouped Category and Value aggregate", () => {
    const dataView = {
      categorical: {
        categories: [{
          source: { displayName: "Category", roles: { Category: true } },
          values: ["A"],
        }],
        values: [{
          source: { displayName: "Value", roles: { Value: true } },
          values: [42],
        }],
      },
    } as unknown as powerbi.DataView;

    expect(extractObservations(dataView)).toEqual([]);
  });

  test("requires Sample in table mappings", () => {
    const dataView = {
      table: {
        columns: [
          { displayName: "Category", roles: { Category: true } },
          { displayName: "Value", roles: { Value: true } },
        ],
        rows: [["A", 42]],
      },
    } as unknown as powerbi.DataView;

    expect(extractObservations(dataView)).toEqual([]);
  });

  test("builds table selection identities for sample-level interaction", () => {
    const dataView = {
      table: {
        columns: [
          { displayName: "Category", roles: { Category: true } },
          { displayName: "Sample", roles: { Sample: true } },
          { displayName: "Value", roles: { Value: true } },
        ],
        rows: [["A", "s1", 42]],
      },
    } as unknown as powerbi.DataView;
    const selectionId = { getKey: () => "row-0" } as unknown as powerbi.visuals.ISelectionId;

    const observations = extractObservations(dataView, {
      createTableSelectionId: () => selectionId,
      selectedKeys: new Set(["row-0"]),
    });

    expect(observations[0]).toMatchObject({
      sample: "s1",
      selectionId,
      selectionKey: "row-0",
      selected: true,
    });
  });
});
