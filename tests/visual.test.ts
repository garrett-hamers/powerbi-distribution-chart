import powerbi from "powerbi-visuals-api";
jest.mock("powerbi-visuals-utils-formattingutils", () => ({
  valueFormatter: {
    format: (value: unknown) => String(value),
  },
}));
import { Visual } from "../src/visual";

function makeVisualHost() {
  let selectionCallback: ((ids: powerbi.extensibility.ISelectionId[]) => void) | undefined;
  const selectionIds: powerbi.extensibility.ISelectionId[] = [];
  const selectionManager = {
    registerOnSelectCallback: (callback: (ids: powerbi.extensibility.ISelectionId[]) => void) => {
      selectionCallback = callback;
    },
    getSelectionIds: () => selectionIds,
    select: jest.fn((id: powerbi.extensibility.ISelectionId) => {
      selectionIds.splice(0, selectionIds.length, id);
      selectionCallback?.([id]);
      return Promise.resolve([id]);
    }),
    clear: jest.fn(() => {
      selectionIds.splice(0, selectionIds.length);
      selectionCallback?.([]);
      return Promise.resolve({});
    }),
    showContextMenu: jest.fn(() => Promise.resolve({})),
  };
  const host = {
    locale: "en-US",
    createSelectionManager: () => selectionManager,
    createSelectionIdBuilder: () => {
      let key = "";
      const builder: {
        withCategory: (_column: unknown, index: number) => typeof builder;
        withSeries: (_values: unknown, group: { name?: unknown }) => typeof builder;
        createSelectionId: () => object;
      } = {
        withCategory: (_column: unknown, index: number) => {
          key = `category:${index}`;
          return builder;
        },
        withSeries: (_values: unknown, group: { name?: unknown }) => {
          key += `:sample:${String(group.name)}`;
          return builder;
        },
        createSelectionId: () => ({
          getKey: () => key,
          equals: () => false,
          includes: () => false,
          getSelector: () => ({}),
          getSelectorsByColumn: () => ({}),
          hasIdentity: () => true,
        }),
      };
      return builder;
    },
    colorPalette: {
      isHighContrast: false,
      foreground: { value: "#334155" },
      background: { value: "#ffffff" },
      foregroundSelected: { value: "#0ea5e9" },
    },
    tooltipService: {
      enabled: () => true,
      show: jest.fn(),
      move: jest.fn(),
      hide: jest.fn(),
    },
    eventService: {
      renderingStarted: jest.fn(),
      renderingFinished: jest.fn(),
      renderingFailed: jest.fn(),
    },
    persistProperties: jest.fn(),
    createLocalizationManager: () => ({
      getDisplayName: (key: string) => key,
    }),
  };
  return { host, selectionManager };
}

function makeDataView(): powerbi.DataView {
  const categoryColumn = {
    source: { displayName: "Category", roles: { Category: true } },
    values: ["A", "B"],
  };
  const valueColumn = {
    source: { displayName: "Value", roles: { Value: true }, format: "0.0" },
    values: [1, 2],
  };
  const values = [valueColumn] as unknown as powerbi.DataViewValueColumns;
  values.grouped = () => [{
    name: "Sample",
    values: [valueColumn],
  }];
  return {
    categorical: {
      categories: [categoryColumn],
      values,
    },
  } as unknown as powerbi.DataView;
}

function createVisual() {
  const hostDetails = makeVisualHost();
  const element = document.createElement("div");
  document.body.appendChild(element);
  const visual = new Visual({
    element,
    host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
  });
  visual.update({
    dataViews: [makeDataView()],
    viewport: { width: 500, height: 300 },
    type: 2,
  } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);
  return { ...hostDetails, element, visual };
}

function makeRichDataView(): powerbi.DataView {
  const categoryColumn = {
    source: { displayName: "Category", roles: { Category: true } },
    values: ["A", "A", "A", "A", "A", "A", "A", "A", "A"],
  };
  const valueColumn = {
    source: { displayName: "Value", roles: { Value: true }, format: "$0.00" },
    values: [-10, 0, 1, 2, 3, 4, 5, 20, 20],
    highlights: [null, 0, null, null, null, null, null, null, null],
  };
  const values = [valueColumn] as unknown as powerbi.DataViewValueColumns;
  values.grouped = () => [{
    name: "Sample",
    values: [valueColumn],
  }];
  return {
    categorical: {
      categories: [categoryColumn],
      values,
    },
  } as unknown as powerbi.DataView;
}

function makeSettingsDataView(): powerbi.DataView {
  const dataView = makeRichDataView() as powerbi.DataView;
  dataView.metadata = {
    columns: [],
    objects: {
      general: {
        showMean: false,
        showOutliers: false,
        markerSize: 10,
        labelSize: 16,
      },
    },
  };
  return dataView;
}

describe("Visual interaction and lifecycle behavior", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("renders events, semantic table, keyboard focus, selection, and context menu", () => {
    const { element, visual, host, selectionManager } = createVisual();
    const categories = element.querySelectorAll<SVGGElement>(".atlyn-category");
    expect(categories).toHaveLength(2);
    expect(element.querySelector("table.atlyn-summary")).not.toBeNull();
    expect(host.eventService.renderingStarted).toHaveBeenCalledTimes(1);
    expect(host.eventService.renderingFinished).toHaveBeenCalledTimes(1);

    (categories[0] as SVGGElement).focus();
    categories[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selectionManager.select).toHaveBeenCalled();
    const refreshedCategory = element.querySelector<SVGGElement>(".atlyn-category");
    refreshedCategory?.focus();
    refreshedCategory?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(selectionManager.select).toHaveBeenCalledTimes(2);
    categories[0].dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 10,
      clientY: 20,
    }));
    expect(selectionManager.showContextMenu).toHaveBeenCalled();
    expect(element.querySelector(".atlyn-category")?.getAttribute("aria-label")).toContain("Type 7");
    expect(element.querySelector(".atlyn-category")?.getAttribute("aria-selected")).toBe("true");
    expect(host.tooltipService.hide).toHaveBeenCalled();
    visual.destroy();
    expect(element.childElementCount).toBe(0);
  });

  test("makes highlights and selected observations visible with semantic states", () => {
    const hostDetails = makeVisualHost();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({
      element,
      host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
    });
    visual.update({
      dataViews: [makeRichDataView()],
      viewport: { width: 500, height: 300 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);

    const highlighted = element.querySelector(".atlyn-highlight");
    expect(highlighted).not.toBeNull();
    expect(highlighted?.getAttribute("aria-selected")).toBe("false");
    expect(highlighted?.getAttribute("data-highlighted")).toBe("true");
    expect(element.querySelector(".atlyn-category")?.getAttribute("data-highlighted")).toBe("true");

    const outlier = element.querySelector<SVGElement>(".atlyn-outlier");
    outlier?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const selectedOutlier = element.querySelector<SVGElement>(".atlyn-outlier");
    expect(selectedOutlier?.classList.contains("atlyn-selected")).toBe(true);
    expect(selectedOutlier?.getAttribute("aria-selected")).toBe("true");

    selectedOutlier?.focus();
    selectedOutlier?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(hostDetails.selectionManager.select).toHaveBeenCalled();
    visual.destroy();
  });

  test("supports tooltip show, move, hide, and touch long press", () => {
    jest.useFakeTimers();
    const hostDetails = makeVisualHost();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({
      element,
      host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
    });
    visual.update({
      dataViews: [makeRichDataView()],
      viewport: { width: 500, height: 300 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);

    const category = element.querySelector<SVGGElement>(".atlyn-category");
    category?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 20 }));
    category?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 12, clientY: 22 }));
    category?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(hostDetails.host.tooltipService.show).toHaveBeenCalledWith(expect.objectContaining({
      isTouchEvent: false,
      dataItems: expect.arrayContaining([
        expect.objectContaining({ displayName: "Mean" }),
      ]),
    }));
    expect(hostDetails.host.tooltipService.move).toHaveBeenCalled();
    expect(hostDetails.host.tooltipService.hide).toHaveBeenCalledWith(expect.objectContaining({
      isTouchEvent: false,
    }));

    const outlier = element.querySelector<SVGElement>(".atlyn-outlier");
    const touchStart = new Event("touchstart", { bubbles: true });
    Object.defineProperty(touchStart, "changedTouches", {
      value: [{ clientX: 30, clientY: 40 }],
    });
    outlier?.dispatchEvent(touchStart);
    jest.advanceTimersByTime(600);
    expect(hostDetails.host.tooltipService.show).toHaveBeenLastCalledWith(expect.objectContaining({
      isTouchEvent: true,
      coordinates: [30, 40],
    }));
    expect(hostDetails.selectionManager.showContextMenu).toHaveBeenCalled();
    const touchEnd = new Event("touchend", { bubbles: true });
    outlier?.dispatchEvent(touchEnd);
    expect(hostDetails.host.tooltipService.hide).toHaveBeenLastCalledWith(expect.objectContaining({
      isTouchEvent: true,
    }));
    visual.destroy();
    jest.useRealTimers();
  });

  test("applies persisted formatting settings to rendering", () => {
    const hostDetails = makeVisualHost();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({
      element,
      host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
    });
    visual.update({
      dataViews: [makeSettingsDataView()],
      viewport: { width: 320, height: 220 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);

    const formattingModel = visual.getFormattingModel();
    expect(formattingModel?.cards[0]).toMatchObject({
      groups: [{
        slices: expect.arrayContaining([
          expect.objectContaining({ uid: "markerSize" }),
          expect.objectContaining({ uid: "labelSize" }),
        ]),
      }],
    });
    expect(element.querySelectorAll(".atlyn-outlier")).toHaveLength(0);
    expect(element.querySelectorAll("path")).toHaveLength(0);
    expect(element.querySelector(".atlyn-observation")?.getAttribute("r")).toBe("13");
    visual.destroy();
  });

  test("reports rendering failures and propagates the error", () => {
    const { visual, host } = createVisual();
    const render = jest.spyOn(visual as unknown as { render: (options: unknown) => void }, "render")
      .mockImplementation(() => {
        throw new Error("render failure");
      });

    expect(() => visual.update({
      dataViews: [makeDataView()],
      viewport: { width: 500, height: 300 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions)).toThrow("render failure");
    expect(host.eventService.renderingStarted).toHaveBeenCalledTimes(2);
    expect(host.eventService.renderingFinished).toHaveBeenCalledTimes(1);
    expect(host.eventService.renderingFailed).toHaveBeenCalledWith(
      expect.anything(),
      "render failure",
    );
    render.mockRestore();
    visual.destroy();
  });

  test("supports clear selection, RTL layout, and high contrast marker semantics", () => {
    const hostDetails = makeVisualHost();
    hostDetails.host.locale = "ar-SA";
    hostDetails.host.colorPalette.isHighContrast = true;
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({
      element,
      host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
    });
    visual.update({
      dataViews: [makeRichDataView()],
      viewport: { width: 320, height: 220 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);

    expect(element.getAttribute("dir")).toBe("rtl");
    expect(element.classList.contains("atlyn-mobile")).toBe(true);
    expect(element.dataset.reducedMotion).toBe("false");
    expect(element.querySelectorAll(".atlyn-outlier")).toHaveLength(3);
    expect(element.querySelectorAll(".atlyn-highlight")).toHaveLength(1);
    expect(element.querySelector(".atlyn-outlier")?.tagName.toLowerCase()).toBe("path");
    expect(element.querySelector(".atlyn-box")?.getAttribute("stroke-width")).toBe("2");
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(hostDetails.selectionManager.clear).toHaveBeenCalled();
    visual.destroy();
  });

  test("shows truthful invalid and empty states", () => {
    const hostDetails = makeVisualHost();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({
      element,
      host: hostDetails.host as unknown as powerbi.extensibility.visual.IVisualHost,
    });
    visual.update({
      dataViews: [],
      viewport: { width: 300, height: 200 },
      type: 2,
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions);

    expect(element.textContent).toContain("Add Category");
    expect(hostDetails.host.eventService.renderingFinished).toHaveBeenCalled();
    visual.destroy();
  });
});
