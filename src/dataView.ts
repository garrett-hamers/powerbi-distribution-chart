import powerbi from "powerbi-visuals-api";
import {
  MAX_OBSERVATIONS,
  RawObservation,
  buildDistributionModel,
  DistributionModel,
} from "./analytics";

type DataView = powerbi.DataView;
type DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
type DataViewValueColumn = powerbi.DataViewValueColumn;
type DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
type SelectionId = powerbi.visuals.ISelectionId;

export interface DataViewExtractionOptions {
  createSelectionId?: (
    categoryColumn: DataViewCategoryColumn,
    categoryIndex: number,
    values: powerbi.DataViewValueColumns,
    group?: DataViewValueColumnGroup,
  ) => SelectionId | undefined;
  createTableSelectionId?: (
    table: powerbi.DataViewTable,
    rowIndex: number,
  ) => SelectionId | undefined;
  selectedKeys?: ReadonlySet<string>;
}

function hasRole(
  column: {
    source?: { roles?: { [name: string]: boolean } };
    roles?: { [name: string]: boolean };
  },
  role: string,
): boolean {
  return column.source?.roles?.[role] === true || column.roles?.[role] === true;
}

function displayValue(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function valueAt(column: DataViewValueColumn | undefined, index: number): unknown {
  return column?.values?.[index];
}

function createRawObservation(
  category: string,
  sample: string,
  value: unknown,
  categoryColumn: DataViewCategoryColumn | undefined,
  categoryIndex: number,
  values: powerbi.DataViewValueColumns | undefined,
  group: DataViewValueColumnGroup | undefined,
  valueFormat: string | undefined,
  tooltipValues: Array<{ label: string; value: unknown; format?: string }>,
  highlighted: boolean,
  options: DataViewExtractionOptions,
): RawObservation {
  const categorySelectionId = categoryColumn && values
    ? options.createSelectionId?.(categoryColumn, categoryIndex, values)
    : undefined;
  const selectionId = categoryColumn && values
    ? options.createSelectionId?.(categoryColumn, categoryIndex, values, group)
    : undefined;
  const selectionKey = selectionId?.getKey();
  const categorySelectionKey = categorySelectionId?.getKey();

  return {
    category,
    sample,
    value,
    valueFormat,
    tooltipValues,
    selectionId,
    selectionKey,
    categorySelectionId,
    categorySelectionKey,
    selected: Boolean(
      (selectionKey && options.selectedKeys?.has(selectionKey))
      || (categorySelectionKey && options.selectedKeys?.has(categorySelectionKey)),
    ),
    highlighted,
  };
}

function extractCategorical(
  categorical: powerbi.DataViewCategorical,
  options: DataViewExtractionOptions,
): RawObservation[] {
  const categoryColumn = categorical.categories?.find((column) => hasRole(column, "Category"));
  const values = categorical.values;
  if (!categoryColumn || !values || typeof values.grouped !== "function") {
    return [];
  }

  const categoryCount = categoryColumn.values.length;
  const groups = values.grouped();
  const observations: RawObservation[] = [];

  if (groups.length === 0) {
    return [];
  }

  groups.forEach((group) => {
    const valueColumn = group.values.find((column) => hasRole(column, "Value"));
    if (!valueColumn) {
      return;
    }
    const tooltipColumns = group.values.filter((column) => hasRole(column, "Tooltips"));
    const sample = displayValue(group.name, "(Blank sample)");
    const rowCount = Math.min(categoryCount, valueColumn.values.length);

    for (let categoryIndex = 0; categoryIndex < rowCount; categoryIndex += 1) {
      const tooltipValues = tooltipColumns.map((column) => ({
        label: column.source.displayName,
        value: valueAt(column, categoryIndex),
        format: column.source.format,
      }));
      observations.push(createRawObservation(
        displayValue(categoryColumn.values[categoryIndex], "(Blank category)"),
        sample,
        valueAt(valueColumn, categoryIndex),
        categoryColumn,
        categoryIndex,
        values,
        group,
        valueColumn.source.format,
        tooltipValues,
        valueColumn.highlights?.[categoryIndex] !== undefined
          && valueColumn.highlights[categoryIndex] !== null,
        options,
      ));
    }
  });
  return observations;
}

function extractTable(table: powerbi.DataViewTable, options: DataViewExtractionOptions): RawObservation[] {
  const categoryIndex = table.columns.findIndex((column) => hasRole(column, "Category"));
  const sampleIndex = table.columns.findIndex((column) => hasRole(column, "Sample"));
  const valueIndex = table.columns.findIndex((column) => hasRole(column, "Value"));
  const tooltipIndexes = table.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => hasRole(column, "Tooltips"));

  if (categoryIndex < 0 || sampleIndex < 0 || valueIndex < 0 || !table.rows) {
    return [];
  }

  return table.rows.map((row, rowIndex) => {
    const identity = table.identity?.[rowIndex];
    const selectionId = options.createTableSelectionId?.(table, rowIndex);
    const selectionKey = selectionId?.getKey() ?? (identity ? String(identity) : undefined);
    return {
      category: displayValue(row[categoryIndex], "(Blank category)"),
      sample: displayValue(row[sampleIndex], `(Row ${rowIndex + 1})`),
      value: row[valueIndex],
      tooltipValues: tooltipIndexes.map(({ column, index }) => ({
        label: column.displayName,
        value: row[index],
        format: column.format,
      })),
      selectionKey,
      selectionId,
      selected: Boolean(
        (selectionKey && options.selectedKeys?.has(selectionKey))
        || (identity && options.selectedKeys?.has(String(identity))),
      ),
    };
  });
}

export function extractObservations(
  dataView: DataView | undefined,
  options: DataViewExtractionOptions = {},
): RawObservation[] {
  if (!dataView) {
    return [];
  }
  if (dataView.categorical) {
    return extractCategorical(dataView.categorical, options);
  }
  if (dataView.table) {
    return extractTable(dataView.table, options);
  }
  return [];
}

export function buildModelFromDataView(
  dataView: DataView | undefined,
  options: DataViewExtractionOptions = {},
): DistributionModel {
  const observations = extractObservations(dataView, options);
  return buildDistributionModel(observations, {
    maxObservations: MAX_OBSERVATIONS,
    receivedRows: observations.length,
  });
}
