import { SCENES } from "./scenes.mjs";

/**
 * Loads the packaged Atlyn Distribution bundle into a mock Power BI host and renders
 * one screenshot scene. The mock host mirrors the host contract already exercised by
 * `tests/visual.test.ts`; the chart itself is produced entirely by the packaged visual.
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

function createHost() {
  const selectionManager = createSelectionManager();
  return {
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    createSelectionManager: () => selectionManager,
    createSelectionIdBuilder,
    colorPalette: {
      isHighContrast: false,
      foreground: { value: "#334155" },
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

function applySettings(dataView, settings) {
  if (!settings) {
    return dataView;
  }
  dataView.metadata = { ...(dataView.metadata ?? {}), objects: { general: { ...settings } } };
  return dataView;
}

function fail(message) {
  document.documentElement.dataset.harnessError = message;
  document.title = `HARNESS ERROR: ${message}`;
  throw new Error(message);
}

function render() {
  const sceneId = new URLSearchParams(window.location.search).get("scene") ?? SCENES[0].id;
  const scene = SCENES.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    fail(`Unknown scene "${sceneId}"`);
  }

  document.getElementById("heading").textContent = scene.heading;
  document.getElementById("caption").textContent = scene.caption;

  const plugin = window.powerbi?.visuals?.plugins?.[VISUAL_GUID]
    ?? window[VISUAL_GUID]?.default;
  if (!plugin || typeof plugin.create !== "function") {
    fail("Packaged visual plugin was not registered - rebuild with `npm run package`.");
  }

  const element = document.getElementById("visual");
  const visual = plugin.create({ element, host: createHost() });
  let lastViewport = { width: 0, height: 0 };

  const update = () => {
    const bounds = element.getBoundingClientRect();
    lastViewport = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    visual.update({
      dataViews: [applySettings(scene.dataView(), scene.settings)],
      viewport: lastViewport,
      type: 2,
      viewMode: 1,
      editMode: 0,
      isInFocus: false,
      operationKind: 0,
      jsonFilters: [],
    });
    if (scene.selectCategory) {
      const target = element.querySelector(`[data-category="${scene.selectCategory}"]`);
      if (!target) {
        fail(`Scene "${scene.id}" could not find category "${scene.selectCategory}" to select.`);
      }
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };

  update();

  if (!element.querySelector("svg .atlyn-category")) {
    fail(`Scene "${scene.id}" rendered no distributions.`);
  }

  // The capture harness resizes the viewport after load, exactly like a real host does.
  window.addEventListener("resize", () => {
    const bounds = element.getBoundingClientRect();
    if (Math.round(bounds.width) !== lastViewport.width || Math.round(bounds.height) !== lastViewport.height) {
      update();
    }
  });

  document.documentElement.dataset.harnessScene = scene.id;
  document.documentElement.dataset.harnessReady = "true";
  document.title = `READY:${scene.id}`;
}

render();
