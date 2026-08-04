import { CATEGORIES, buildDataView } from "./sample-data.mjs";

/**
 * Screenshot scenes for the AppSource listing. Each scene is a real render of the
 * packaged visual over the committed offline sample data - nothing here draws or
 * fakes chart output.
 */
export const SCENES = [
  {
    id: "01-grouped-distributions",
    heading: "Compare grouped distributions on raw observations",
    caption: "Five production lines, forty runs each. Every box uses Hyndman-Fan Type 7 quartiles and "
      + "Tukey 1.5xIQR whiskers, with the median drawn in blue, the mean as a cross, and every genuine "
      + "outlier plotted individually. The header line reports exactly how many rows were received and "
      + "rendered.",
    dataView: () => buildDataView(),
    settings: { markerSize: 4, labelSize: 14 },
  },
  {
    id: "02-outliers-and-diagnostics",
    heading: "Real outliers, including the zero-IQR case",
    caption: "Tukey outliers stay outliers. Line E has an interquartile range of zero, so the repeated "
      + "value is itself the fence and the 55.0 s run is still reported as a genuine outlier instead of "
      + "being silently absorbed.",
    dataView: () => buildDataView({ categories: ["Line C", "Line D", "Line E"] }),
    settings: { markerSize: 6, labelSize: 15 },
  },
  {
    id: "03-selection-and-highlight",
    heading: "Cross-highlighting and selection built on host identities",
    caption: "Report cross-highlighting dims unrelated distributions and plots the highlighted rows as "
      + "individual observations, and clicking a distribution selects it through the host selection "
      + "manager so the rest of the report filters with it.",
    dataView: () => buildDataView({ highlightedCategories: ["Line B"] }),
    settings: { markerSize: 4, labelSize: 14 },
    selectCategory: CATEGORIES[1],
  },
];

export const SCENE_IDS = SCENES.map((scene) => scene.id);
