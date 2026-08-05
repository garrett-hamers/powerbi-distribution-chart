import { SCENARIOS } from "./scenarios.mjs";
import { measureDataSurvival, measureOverflow } from "./measure.mjs";

/**
 * In-page driver for the layout probe.
 *
 * Loads the *packaged* Atlyn Distribution bundle into a mock Power BI host, renders one
 * probe case into a fixed-size tile that clips exactly like the host does, and measures
 * the result with real browser layout. The mock host mirrors the contract already
 * exercised by `tests/visual.test.ts` and by the screenshot harness; every rectangle
 * measured here comes from the real built visual.
 */

const VISUAL_GUID = "atlynDistributionA1B2C3D4E5F6G7H8I9J0";

function createSelectionManager() {
  const selectionIds = [];
  let onSelect;
  return {
    registerOnSelectCallback: (callback) => {
      onSelect = callback;
    },
    getSelectionIds: () => selectionIds,
    select: (id, multiSelect) => {
      if (!multiSelect) {
        selectionIds.length = 0;
      }
      selectionIds.push(id);
      onSelect?.([...selectionIds]);
      return Promise.resolve([...selectionIds]);
    },
    clear: () => {
      selectionIds.length = 0;
      onSelect?.([]);
      return Promise.resolve({});
    },
    showContextMenu: () => Promise.resolve({}),
    hasSelection: () => selectionIds.length > 0,
  };
}

function createSelectionIdBuilder() {
  let key = "";
  const builder = {
    withCategory: (column, index) => {
      key = `category:${String(column?.values?.[index])}`;
      return builder;
    },
    withSeries: (_values, group) => {
      key += `:sample:${String(group?.name)}`;
      return builder;
    },
    withTable: (_table, rowIndex) => {
      key = `table-row:${rowIndex}`;
      return builder;
    },
    withMeasure: () => builder,
    createSelectionId: () => {
      const identity = key;
      return {
        getKey: () => identity,
        equals: (other) => other?.getKey?.() === identity,
        includes: (other) => other?.getKey?.() === identity,
        getSelector: () => ({ data: [{ identity }] }),
        getSelectorsByColumn: () => ({}),
        hasIdentity: () => true,
      };
    },
  };
  return builder;
}

function createHost({ locale, highContrast }) {
  const selectionManager = createSelectionManager();
  return {
    locale,
    hostCapabilities: { allowInteractions: true },
    createSelectionManager: () => selectionManager,
    createSelectionIdBuilder,
    colorPalette: {
      isHighContrast: highContrast,
      foreground: { value: highContrast ? "#000000" : "#334155" },
      background: { value: "#ffffff" },
      foregroundSelected: { value: "#0284c7" },
      getColor: () => ({ value: "#0284c7" }),
    },
    tooltipService: {
      enabled: () => false,
      show: () => undefined,
      move: () => undefined,
      hide: () => undefined,
    },
    eventService: {
      renderingStarted: () => undefined,
      renderingFinished: () => undefined,
      renderingFailed: () => undefined,
    },
    persistProperties: () => undefined,
    applyJsonFilter: () => undefined,
    createLocalizationManager: () => ({ getDisplayName: (key) => key }),
  };
}

function resolvePlugin() {
  const plugin = window.powerbi?.visuals?.plugins?.[VISUAL_GUID] ?? window[VISUAL_GUID]?.default;
  if (!plugin || typeof plugin.create !== "function") {
    throw new Error("Packaged visual plugin was not registered - rebuild with `npm run package`.");
  }
  return plugin;
}

const tile = document.getElementById("tile");
const container = document.getElementById("visual");

let active;

function teardown() {
  if (active) {
    try {
      active.destroy?.();
    } catch {
      // A visual that cannot tear down cleanly must not mask the next measurement.
    }
    active = undefined;
  }
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.removeAttribute("class");
  container.removeAttribute("style");
  container.removeAttribute("role");
  container.removeAttribute("aria-label");
  container.removeAttribute("dir");
  container.removeAttribute("tabindex");
  delete container.dataset.reducedMotion;
}

/**
 * Renders one probe case and returns its measurements.
 *
 * @param {{ scenario: string, settings?: object, locale: string, highContrast?: boolean, width: number, height: number }} spec
 */
function run(spec) {
  teardown();

  tile.style.width = `${spec.width}px`;
  tile.style.height = `${spec.height}px`;

  const build = SCENARIOS[spec.scenario];
  if (!build) {
    throw new Error(`Unknown probe scenario "${spec.scenario}".`);
  }

  const dataView = build();
  if (dataView && spec.settings) {
    dataView.metadata = { ...(dataView.metadata ?? {}), objects: { general: { ...spec.settings } } };
  }

  const plugin = resolvePlugin();
  active = plugin.create({
    element: container,
    host: createHost({ locale: spec.locale, highContrast: spec.highContrast === true }),
  });

  const bounds = container.getBoundingClientRect();
  active.update({
    dataViews: dataView ? [dataView] : [],
    viewport: { width: Math.round(bounds.width), height: Math.round(bounds.height) },
    type: 2,
    viewMode: 1,
    editMode: 0,
    isInFocus: false,
    operationKind: 0,
    jsonFilters: [],
  });

  // Force a synchronous layout flush before measuring.
  void container.getBoundingClientRect();

  const overflow = measureOverflow(container, { view: window });
  const data = measureDataSurvival(container);

  return {
    id: spec.id,
    viewport: { width: spec.width, height: spec.height },
    tile: {
      width: Math.round(tile.getBoundingClientRect().width),
      height: Math.round(tile.getBoundingClientRect().height),
    },
    overflow,
    data,
    dir: container.getAttribute("dir"),
    elementCount: container.querySelectorAll("*").length,
  };
}

window.__atlynProbe = {
  run: (spec) => {
    try {
      return { ok: true, result: run(spec) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) };
    }
  },
};

try {
  resolvePlugin();
  document.documentElement.dataset.probeReady = "true";
} catch (error) {
  document.documentElement.dataset.probeError = error instanceof Error ? error.message : String(error);
}
