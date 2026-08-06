import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import {
  Distribution,
  DistributionModel,
  MAX_OBSERVATIONS,
  Outlier,
  ValidObservation,
  buildDistributionModel,
} from "./analytics";
import { extractObservations } from "./dataView";

type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type IVisualHost = powerbi.extensibility.visual.IVisualHost;
type SelectionId = powerbi.visuals.ISelectionId;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_RENDERED_MARKERS_PER_DISTRIBUTION = 2000;

/**
 * Layout budget for the plot area.
 *
 * A Power BI tile clips with `overflow: hidden`, so any pixel the chart draws outside
 * its own viewport is silently lost. Reserved bands therefore have to be a *preference*
 * that shrinks, never a constant: a fixed 90px value gutter is 7% of a 1280px tile and
 * 113% of an 80px one, and at the small end it pushes the entire plot off the canvas.
 * `MAX_MARGIN_SHARE` caps what the reserved bands may take, which leaves the preferred
 * values untouched on every tile wide enough to afford them.
 */
const PREFERRED_VALUE_GUTTER = 90;
const PREFERRED_EDGE_MARGIN = 24;
const MAX_MARGIN_SHARE = 0.55;

/** The status band is chrome: it gets one line, or none at all on a tile this small. */
const DIAGNOSTICS_BAND_HEIGHT = 22;
const MIN_DIAGNOSTICS_WIDTH = 150;
const MIN_DIAGNOSTICS_HEIGHT = 90;

const ELLIPSIS = "\u2026";


type StringKey =
  | "title"
  | "empty"
  | "invalid"
  | "smallSample"
  | "summary"
  | "diagnostics"
  | "partialData"
  | "boundedData"
  | "noData"
  | "category"
  | "sampleCount"
  | "q1"
  | "median"
  | "q3"
  | "mean"
  | "iqr"
  | "lowerFence"
  | "upperFence"
  | "lowerWhisker"
  | "upperWhisker"
  | "outliers"
  | "method"
  | "rule"
  | "type7"
  | "tukey"
  | "value"
  | "sample"
  | "selected"
  | "distribution"
  | "showMean"
  | "showOutliers"
  | "markerSize"
  | "labelSize";

const resourceKeys: Record<StringKey, string> = {
  title: "AtlynDistribution_Title",
  empty: "AtlynDistribution_Empty",
  invalid: "AtlynDistribution_Invalid",
  smallSample: "AtlynDistribution_SmallSample",
  summary: "AtlynDistribution_Summary",
  diagnostics: "AtlynDistribution_Diagnostics",
  partialData: "AtlynDistribution_PartialData",
  boundedData: "AtlynDistribution_BoundedData",
  noData: "AtlynDistribution_NoData",
  category: "AtlynDistribution_Category",
  sampleCount: "AtlynDistribution_SampleCount",
  q1: "AtlynDistribution_Q1",
  median: "AtlynDistribution_Median",
  q3: "AtlynDistribution_Q3",
  mean: "AtlynDistribution_Mean",
  iqr: "AtlynDistribution_IQR",
  lowerFence: "AtlynDistribution_LowerFence",
  upperFence: "AtlynDistribution_UpperFence",
  lowerWhisker: "AtlynDistribution_LowerWhisker",
  upperWhisker: "AtlynDistribution_UpperWhisker",
  outliers: "AtlynDistribution_Outliers",
  method: "AtlynDistribution_Quartiles",
  rule: "AtlynDistribution_Whiskers",
  type7: "AtlynDistribution_Type7",
  tukey: "AtlynDistribution_Tukey",
  value: "AtlynDistribution_Value",
  sample: "AtlynDistribution_Sample",
  selected: "AtlynDistribution_Selected",
  distribution: "AtlynDistribution_Distribution",
  showMean: "AtlynDistribution_ShowMean",
  showOutliers: "AtlynDistribution_ShowOutliers",
  markerSize: "AtlynDistribution_MarkerSize",
  labelSize: "AtlynDistribution_LabelSize",
};

const strings: Record<string, Partial<Record<StringKey, string>>> = {
  en: {
    title: "Atlyn Distribution",
    empty: "Add Category, Sample, and Value fields to show raw observations.",
    invalid: "No finite numeric observations were received for this category.",
    smallSample: "Small sample: statistics are shown, but the sample has fewer than three valid observations.",
    summary: "Accessible distribution summary",
    diagnostics: "Data status",
    partialData: "Partial data may be shown: {0} valid observations rendered from {1} received rows; {2} rows outside the {3}-row window were not rendered. Completeness is not asserted.",
    boundedData: "{0} valid observations rendered from {1} received rows. Completeness is not asserted in raw-observation mode.",
    noData: "No distribution data",
    category: "Category",
    sampleCount: "n",
    q1: "Q1",
    median: "Median",
    q3: "Q3",
    mean: "Mean",
    iqr: "IQR",
    lowerFence: "Lower fence",
    upperFence: "Upper fence",
    lowerWhisker: "Lower whisker",
    upperWhisker: "Upper whisker",
    outliers: "Outliers",
    method: "Quartiles",
    rule: "Whiskers",
    type7: "Type 7",
    tukey: "Tukey 1.5xIQR",
    value: "Value",
    sample: "Sample",
    selected: "Selected",
    distribution: "Distribution",
    showMean: "Show mean",
    showOutliers: "Show outliers",
    markerSize: "Marker size",
    labelSize: "Label size",
  },
  es: {
    title: "Atlyn Distribution",
    empty: "Agregue campos Categoría, Muestra y Valor para mostrar observaciones sin procesar.",
    invalid: "No se recibieron observaciones numéricas finitas para esta categoría.",
    smallSample: "Muestra pequeña: hay menos de tres observaciones numéricas válidas.",
    summary: "Resumen de distribución accesible",
    diagnostics: "Estado de los datos",
  },
  fr: {
    title: "Atlyn Distribution",
    empty: "Ajoutez les champs Catégorie, Échantillon et Valeur pour afficher les observations brutes.",
    invalid: "Aucune observation numérique finie n’a été reçue pour cette catégorie.",
    smallSample: "Petit échantillon : moins de trois observations numériques valides.",
    summary: "Résumé accessible de la distribution",
  },
  de: {
    title: "Atlyn Distribution",
    empty: "Fügen Sie die Felder Kategorie, Stichprobe und Wert hinzu, um Rohbeobachtungen anzuzeigen.",
    invalid: "Für diese Kategorie wurden keine endlichen numerischen Beobachtungen empfangen.",
    smallSample: "Kleine Stichprobe: weniger als drei gültige numerische Beobachtungen.",
    summary: "Barrierefreie Verteilungszusammenfassung",
    diagnostics: "Datenstatus",
  },
  ar: {
    title: "Atlyn Distribution",
    empty: "أضف حقول الفئة والعينة والقيمة لعرض الملاحظات الأولية.",
    invalid: "لم يتم استلام ملاحظات رقمية منتهية لهذه الفئة.",
    smallSample: "عينة صغيرة: أقل من ثلاث ملاحظات رقمية صالحة.",
    summary: "ملخص توزيع يمكن الوصول إليه",
    diagnostics: "حالة البيانات",
  },
};

function isRtl(locale: string): boolean {
  return /^(ar|fa|he|ur)([-_]|$)/i.test(locale);
}

function isReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDataPointTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest(".atlyn-category, .atlyn-observation, .atlyn-outlier"));
}

/**
 * A request to make one SVG text run fit inside a width, resolved once the element is
 * in the live document.
 *
 * SVG `<text>` neither wraps nor truncates. `text-overflow: ellipsis` does nothing to
 * it - and would do nothing even on an HTML box unless `white-space: nowrap` were set
 * alongside it, which is its own well-worn trap. The only way to bound an SVG text run
 * is to measure it against the real font and rewrite the string, which means it has to
 * happen after the element is attached and laid out.
 */
interface TextFit {
  element: SVGTextElement;
  maxWidth: number;
  maxLines: number;
  lineHeight: number;
  /** When set, the block is centred vertically on this baseline instead of starting at it. */
  centerOn?: number;
  /**
   * When set, the laid-out block is nudged up so its rendered box ends here.
   *
   * Baselines are placed from constants, but glyph extents come from whatever font the
   * host happens to resolve - and a CI runner's font stack is not the developer's. This
   * asks the engine where the text actually landed instead of guessing at ascent and
   * descent ratios.
   */
  maxBottom?: number;
}

/**
 * Word-wraps and ellipsizes `element` so it never exceeds `maxWidth`.
 *
 * Returns silently when the engine cannot measure text - JSDOM has no layout engine, so
 * `getComputedTextLength` is absent there and any measurement would be a fabrication.
 * The layout probe runs in real Chromium precisely because this is unmeasurable
 * anywhere else.
 */
function fitSvgText(fit: TextFit): void {
  layoutSvgText(fit);
  clampTextBottom(fit);
}

/** Pulls a laid-out text block up until its measured box sits inside `maxBottom`. */
function clampTextBottom(fit: TextFit): void {
  if (fit.maxBottom === undefined) {
    return;
  }
  const measurable = fit.element as SVGTextElement & { getBBox?: () => { y: number; height: number } };
  if (typeof measurable.getBBox !== "function") {
    return;
  }
  let box: { y: number; height: number };
  try {
    box = measurable.getBBox();
  } catch {
    // getBBox throws on elements that are not rendered; nothing to clamp in that case.
    return;
  }
  const overshoot = box.y + box.height - fit.maxBottom;
  if (overshoot <= 0) {
    return;
  }
  const current = Number.parseFloat(fit.element.getAttribute("y") ?? "0");
  fit.element.setAttribute("y", String(current - overshoot));
}

function layoutSvgText(fit: TextFit): void {
  const { element, maxLines, lineHeight } = fit;
  const measurable = element as SVGTextElement & { getComputedTextLength?: () => number };
  if (typeof measurable.getComputedTextLength !== "function") {
    return;
  }

  const source = (element.textContent ?? "").trim();
  if (source.length === 0) {
    return;
  }

  const maxWidth = fit.maxWidth;
  if (maxWidth <= 1) {
    element.textContent = "";
    return;
  }

  const measure = (candidate: string): number => {
    element.textContent = candidate;
    return measurable.getComputedTextLength?.() ?? 0;
  };

  if (measure(source) <= maxWidth) {
    element.textContent = source;
    return;
  }

  /** Longest prefix of `text` that still fits once the ellipsis is appended. */
  const truncate = (text: string): string => {
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (measure(`${text.slice(0, mid).trimEnd()}${ELLIPSIS}`) <= maxWidth) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low > 0 ? `${text.slice(0, low).trimEnd()}${ELLIPSIS}` : "";
  };

  const words = source.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let index = 0;

  while (index < words.length && lines.length < maxLines) {
    const start = index;
    const isLastLine = lines.length === maxLines - 1;
    let current = "";

    while (index < words.length) {
      const candidate = current.length > 0 ? `${current} ${words[index]}` : words[index];
      if (measure(candidate) > maxWidth) {
        break;
      }
      current = candidate;
      index += 1;
    }

    if (current.length === 0 || (isLastLine && index < words.length)) {
      // Either the next word alone is wider than the line, or this is the last line we
      // are allowed and there is still text left: everything from here gets ellipsized.
      current = truncate(words.slice(start).join(" "));
      index = words.length;
    }

    lines.push(current);
  }

  const rendered = lines.filter((line) => line.length > 0);
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  if (rendered.length <= 1) {
    element.textContent = rendered[0] ?? "";
  } else {
    const x = element.getAttribute("x") ?? "0";
    rendered.forEach((line, lineIndex) => {
      const span = svgElement("tspan", { x, dy: lineIndex === 0 ? "0" : String(lineHeight) });
      span.textContent = line;
      element.appendChild(span);
    });
  }

  if (fit.centerOn !== undefined) {
    const blockHeight = Math.max(0, rendered.length - 1) * lineHeight;
    element.setAttribute("y", String(fit.centerOn - blockHeight / 2));
  }
}


export class Visual implements powerbi.extensibility.visual.IVisual {
  private readonly host: IVisualHost;
  private readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly diagnostics: HTMLDivElement;
  private readonly summaryTable: HTMLTableElement;
  private readonly selectionManager: ReturnType<IVisualHost["createSelectionManager"]>;
  private readonly localizationManager?: powerbi.extensibility.ILocalizationManager;
  private locale: string;
  public readonly allowInteractions: boolean;
  private lastUpdate?: VisualUpdateOptions;
  private lastModel?: DistributionModel;
  private destroyed = false;
  private rtl = false;
  private reducedMotion = false;
  private showMean = true;
  private showOutliers = true;
  private markerSize = 5;
  private labelSize = 12;
  private activeTooltip?: {
    dataItems: powerbi.extensibility.VisualTooltipDataItem[];
    identities: SelectionId[];
  };
  private readonly touchTimers = new Set<number>();

  public constructor(options: VisualConstructorOptions) {
    this.host = options.host;
    this.locale = options.host.locale || "en-US";
    this.allowInteractions = options.host.hostCapabilities?.allowInteractions !== false;
    this.localizationManager = options.host.createLocalizationManager?.();
    this.rtl = isRtl(this.locale);
    this.reducedMotion = isReducedMotion();
    this.root = options.element;
    this.root.classList.add("atlyn-distribution");
    this.root.tabIndex = 0;
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", this.t("title"));
    this.root.setAttribute("dir", this.rtl ? "rtl" : "ltr");
    this.root.dataset.reducedMotion = String(this.reducedMotion);
    this.root.style.position = "relative";
    this.root.style.overflow = "hidden";
    this.root.style.touchAction = "pan-y";

    const title = document.createElement("h2");
    title.className = "atlyn-title";
    title.textContent = this.t("title");
    title.style.position = "absolute";
    title.style.width = "1px";
    title.style.height = "1px";
    title.style.overflow = "hidden";
    title.style.clipPath = "inset(50%)";
    this.root.appendChild(title);

    this.diagnostics = document.createElement("div");
    this.diagnostics.className = "atlyn-diagnostics";
    this.diagnostics.setAttribute("role", "status");
    this.diagnostics.setAttribute("aria-live", "polite");
    this.root.appendChild(this.diagnostics);

    this.svg = svgElement("svg", {
      class: "atlyn-chart",
      role: "img",
      "aria-label": this.t("summary"),
    });
    this.svg.style.display = "block";
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.root.appendChild(this.svg);

    this.summaryTable = document.createElement("table");
    this.summaryTable.className = "atlyn-summary";
    this.summaryTable.setAttribute("aria-label", this.t("summary"));
    this.summaryTable.style.position = "absolute";
    this.summaryTable.style.width = "1px";
    this.summaryTable.style.height = "1px";
    this.summaryTable.style.overflow = "hidden";
    this.summaryTable.style.clipPath = "inset(50%)";
    this.root.appendChild(this.summaryTable);

    this.selectionManager = options.host.createSelectionManager();
    this.selectionManager.registerOnSelectCallback(() => {
      if (!this.destroyed && this.lastUpdate) {
        this.render(this.lastUpdate);
      }
    });

    this.root.addEventListener("click", this.handleCanvasClick);
    this.root.addEventListener("contextmenu", this.handleCanvasContextMenu);
    this.root.addEventListener("keydown", this.handleKeyDown);
    this.root.addEventListener("mouseleave", this.handleCanvasLeave);
  }

  public update(options: VisualUpdateOptions): void {
    this.host.eventService.renderingStarted(options);
    if (this.destroyed) {
      this.host.eventService.renderingFailed(options, "Visual has been destroyed.");
      return;
    }

    this.lastUpdate = options;
    try {
      this.render(options);
      this.host.eventService.renderingFinished(options);
    } catch (error) {
      this.host.eventService.renderingFailed(options, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root.removeEventListener("click", this.handleCanvasClick);
    this.root.removeEventListener("contextmenu", this.handleCanvasContextMenu);
    this.root.removeEventListener("keydown", this.handleKeyDown);
    this.root.removeEventListener("mouseleave", this.handleCanvasLeave);
    this.clearTouchTimers();
    this.hideTooltip(false, true);
    this.lastUpdate = undefined;
    this.lastModel = undefined;
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    const descriptor = (propertyName: string): powerbi.visuals.FormattingDescriptor => ({
      objectName: "general",
      propertyName,
    });
    return {
      cards: [{
        uid: "generalCard",
        displayName: this.t("title"),
        groups: [{
          uid: "distributionGroup",
          displayName: this.t("distribution"),
          slices: [
            {
              uid: "showMean",
              displayName: this.t("showMean"),
              control: {
                type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                properties: {
                  descriptor: descriptor("showMean"),
                  value: this.showMean,
                },
              },
            },
            {
              uid: "showOutliers",
              displayName: this.t("showOutliers"),
              control: {
                type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                properties: {
                  descriptor: descriptor("showOutliers"),
                  value: this.showOutliers,
                },
              },
            },
            {
              uid: "markerSize",
              displayName: this.t("markerSize"),
              control: {
                type: powerbi.visuals.FormattingComponent.NumUpDown,
                properties: {
                  descriptor: descriptor("markerSize"),
                  value: this.markerSize,
                },
              },
            },
            {
              uid: "labelSize",
              displayName: this.t("labelSize"),
              control: {
                type: powerbi.visuals.FormattingComponent.NumUpDown,
                properties: {
                  descriptor: descriptor("labelSize"),
                  value: this.labelSize,
                },
              },
            },
          ],
        }],
      }],
    };
  }

  private t(key: StringKey): string {
    const resourceKey = resourceKeys[key];
    const hostText = this.localizationManager?.getDisplayName(resourceKey);
    if (hostText && hostText !== resourceKey) {
      return hostText;
    }
    const language = this.locale.split(/[-_]/)[0].toLowerCase();
    return strings[language]?.[key] ?? strings.en[key] ?? resourceKey;
  }

  private render(options: VisualUpdateOptions): void {
    this.clearTouchTimers();
    this.hideTooltip(false, true);
    this.locale = this.host.locale || this.locale;
    const dataView = options.dataViews?.[0];
    const selectedKeys = new Set(this.selectionManager.getSelectionIds()
      .map((id) => {
        const keyProvider = id as unknown as { getKey?: () => string };
        return keyProvider.getKey?.();
      })
      .filter((key): key is string => Boolean(key)));
    const observations = extractObservations(dataView, {
      locale: this.locale,
      selectedKeys,
      createSelectionId: (categoryColumn, categoryIndex, values, group) => {
        const builder = this.host.createSelectionIdBuilder().withCategory(categoryColumn, categoryIndex);
        return group ? builder.withSeries(values, group).createSelectionId() : builder.createSelectionId();
      },
      createTableSelectionId: (table, rowIndex) => {
        return this.host.createSelectionIdBuilder().withTable(table, rowIndex).createSelectionId();
      },
    });
    const model = buildDistributionModel(observations, {
      receivedRows: observations.length,
      maxObservations: MAX_OBSERVATIONS,
    });
    this.readSettings(dataView);
    this.lastModel = model;
    this.rtl = isRtl(this.host.locale || this.locale);
    this.reducedMotion = isReducedMotion();
    this.root.setAttribute("dir", this.rtl ? "rtl" : "ltr");
    this.root.classList.toggle("atlyn-reduced-motion", this.reducedMotion);
    this.root.dataset.reducedMotion = String(this.reducedMotion);
    this.root.classList.toggle("atlyn-mobile", options.viewport.width < 420);
    this.root.setAttribute("aria-label", `${this.t("title")}: ${this.diagnosticsLabel(model)}`);
    this.applyColors();
    const diagnosticsVisible = this.renderDiagnostics(model, dataView, options.viewport);
    this.renderChart(model, options.viewport, diagnosticsVisible);
    this.renderSummaryTable(model);
  }

  private readSettings(dataView: powerbi.DataView | undefined): void {
    const general = dataView?.metadata?.objects?.general as { [propertyName: string]: unknown } | undefined;
    if (general) {
      if (typeof general.showMean === "boolean") {
        this.showMean = general.showMean;
      }
      if (typeof general.showOutliers === "boolean") {
        this.showOutliers = general.showOutliers;
      }
      if (finite(general.markerSize)) {
        this.markerSize = Math.min(12, Math.max(3, general.markerSize));
      }
      if (finite(general.labelSize)) {
        this.labelSize = Math.min(18, Math.max(8, general.labelSize));
      }
    }
  }

  private applyColors(): void {
    const palette = this.host.colorPalette;
    const foreground = palette?.foreground?.value ?? "#334155";
    const background = palette?.background?.value ?? "#ffffff";
    const selected = palette?.foregroundSelected?.value ?? "#0ea5e9";
    const highContrast = palette?.isHighContrast === true;
    this.root.style.setProperty("--atlyn-foreground", foreground);
    this.root.style.setProperty("--atlyn-background", background);
    this.root.style.setProperty("--atlyn-selected", selected);
    this.root.style.setProperty("--atlyn-box", highContrast ? background : "#bae6fd");
    this.root.style.setProperty("--atlyn-outlier", highContrast ? foreground : "#e11d48");
    this.root.style.setProperty("--atlyn-muted", highContrast ? foreground : "#64748b");
    this.root.style.color = foreground;
    this.root.style.backgroundColor = background;
  }

  private diagnosticsLabel(model: DistributionModel): string {
    const diagnostics = model.diagnostics;
    const formatCount = (value: number): string => new Intl.NumberFormat(this.locale).format(value);
    if (diagnostics.partialData) {
      return this.t("partialData")
        .replace("{0}", formatCount(diagnostics.renderedRows))
        .replace("{1}", formatCount(diagnostics.receivedRows))
        .replace("{2}", formatCount(diagnostics.droppedRows))
        .replace("{3}", formatCount(diagnostics.maxObservations));
    }
    return this.t("boundedData")
      .replace("{0}", formatCount(diagnostics.renderedRows))
      .replace("{1}", formatCount(diagnostics.receivedRows));
  }

  /**
   * Renders the row-count status band.
   *
   * The band is chrome, so it degrades before anything else does. It is capped at a
   * single ellipsized line, and dropped entirely on a tile too small to carry one
   * usefully. Nothing is lost by dropping it: the same sentence stays in the root's
   * accessible name, in every tooltip, and beside the numbers in the summary table.
   *
   * @returns whether the band was rendered, so the chart can reclaim the space.
   */
  private renderDiagnostics(
    model: DistributionModel,
    dataView: powerbi.DataView | undefined,
    viewport: powerbi.IViewport,
  ): boolean {
    this.diagnostics.replaceChildren();

    const visible = viewport.width >= MIN_DIAGNOSTICS_WIDTH && viewport.height >= MIN_DIAGNOSTICS_HEIGHT;
    this.diagnostics.style.display = visible ? "block" : "none";
    this.root.classList.toggle("atlyn-compact", !visible);
    if (!visible) {
      return false;
    }

    const label = !dataView || model.distributions.length === 0
      ? this.t("empty")
      : this.diagnosticsLabel(model);

    const text = document.createElement("span");
    text.textContent = label;
    // `text-overflow: ellipsis` is inert on its own - it needs `white-space: nowrap`
    // beside it, and it needs a block box with `overflow: hidden` to clip against.
    // The span is made a block for exactly that reason, which also keeps its own border
    // box inside the band instead of letting an inline run measure wider than its parent.
    text.style.display = "block";
    text.style.maxWidth = "100%";
    text.style.whiteSpace = "nowrap";
    text.style.overflow = "hidden";
    text.style.textOverflow = "ellipsis";
    this.diagnostics.appendChild(text);

    this.diagnostics.style.position = "absolute";
    this.diagnostics.style.left = "8px";
    this.diagnostics.style.right = "8px";
    this.diagnostics.style.top = "4px";
    this.diagnostics.style.maxHeight = `${DIAGNOSTICS_BAND_HEIGHT - 4}px`;
    this.diagnostics.style.overflow = "hidden";
    this.diagnostics.style.font = "11px sans-serif";
    this.diagnostics.style.zIndex = "2";
    this.diagnostics.style.pointerEvents = "none";
    this.diagnostics.style.color = "var(--atlyn-foreground)";
    this.diagnostics.setAttribute("aria-label", label);
    return true;
  }

  /**
   * Reserved bands around the plot.
   *
   * Every band is a preference that shrinks rather than a constant. On any tile wide or
   * tall enough to afford them the preferred values come through untouched, which keeps
   * large-tile layout byte-identical; below that they scale down together so the plot
   * area can never collapse or, worse, be pushed off the canvas entirely.
   */
  private chartMargin(
    viewport: powerbi.IViewport,
    diagnosticsVisible: boolean,
  ): { top: number; right: number; bottom: number; left: number } {
    const preferredHorizontal = PREFERRED_VALUE_GUTTER + PREFERRED_EDGE_MARGIN;
    const horizontalScale = Math.min(1, (viewport.width * MAX_MARGIN_SHARE) / preferredHorizontal);
    const gutter = Math.max(6, PREFERRED_VALUE_GUTTER * horizontalScale);
    const edge = Math.max(4, PREFERRED_EDGE_MARGIN * horizontalScale);

    const preferredBottom = viewport.height < 180 ? 42 : 58;
    const bottom = Math.min(preferredBottom, Math.max(18, viewport.height * 0.34));
    const top = diagnosticsVisible
      ? Math.min(30, Math.max(DIAGNOSTICS_BAND_HEIGHT, viewport.height * 0.34))
      : Math.max(4, Math.min(30, viewport.height * 0.08));

    return {
      top,
      right: this.rtl ? gutter : edge,
      bottom,
      left: this.rtl ? edge : gutter,
    };
  }

  private renderChart(
    model: DistributionModel,
    viewport: powerbi.IViewport,
    diagnosticsVisible: boolean,
  ): void {
    this.svg.replaceChildren();
    this.svg.setAttribute("viewBox", `0 0 ${Math.max(1, viewport.width)} ${Math.max(1, viewport.height)}`);
    this.svg.setAttribute("direction", this.rtl ? "rtl" : "ltr");

    // Text runs are measured and trimmed once everything is attached: SVG text cannot be
    // measured before it is in the document, and cannot be measured at all without a
    // layout engine.
    const fits: TextFit[] = [];

    if (model.distributions.length === 0) {
      const emptyText = svgElement("text", {
        class: "atlyn-empty-label",
        x: String(viewport.width / 2),
        y: String(Math.max(24, viewport.height / 2)),
        "text-anchor": "middle",
        fill: "currentColor",
        "font-size": "13",
      });
      emptyText.textContent = this.t("empty");
      this.svg.appendChild(emptyText);
      fits.push({
        element: emptyText,
        maxWidth: Math.max(0, viewport.width - 12),
        maxLines: Math.max(1, Math.min(4, Math.floor((viewport.height - 16) / 16))),
        lineHeight: 16,
        centerOn: Math.max(24, viewport.height / 2),
      });
      fits.forEach(fitSvgText);
      return;
    }

    const margin = this.chartMargin(viewport, diagnosticsVisible);
    const plotWidth = Math.max(1, viewport.width - margin.left - margin.right);
    const plotHeight = Math.max(1, viewport.height - margin.top - margin.bottom);
    let domainMin = Number.POSITIVE_INFINITY;
    let domainMax = Number.NEGATIVE_INFINITY;
    model.distributions.forEach((distribution) => {
      if (distribution.statistics) {
        domainMin = Math.min(domainMin, distribution.statistics.min);
        domainMax = Math.max(domainMax, distribution.statistics.max);
      }
    });
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      domainMin = 0;
      domainMax = 1;
    }
    const padding = domainMin === domainMax ? Math.max(1, Math.abs(domainMin) * 0.1) : (domainMax - domainMin) * 0.08;
    const yMin = domainMin - padding;
    const yMax = domainMax + padding;
    const y = (value: number): number => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    const axis = svgElement("line", {
      x1: String(margin.left),
      x2: String(viewport.width - margin.right),
      y1: String(margin.top + plotHeight),
      y2: String(margin.top + plotHeight),
      stroke: "currentColor",
      "stroke-width": this.host.colorPalette?.isHighContrast === true ? "2" : "1",
      "aria-hidden": "true",
    });
    this.svg.appendChild(axis);

    const categoryWidth = plotWidth / model.distributions.length;
    model.distributions.forEach((distribution, index) => {
      const visualIndex = this.rtl ? model.distributions.length - 1 - index : index;
      const center = margin.left + categoryWidth * (visualIndex + 0.5);
      this.renderCategory(distribution, center, categoryWidth, y, margin.top, plotHeight, viewport, fits);
    });

    fits.forEach(fitSvgText);
  }

  private renderCategory(
    distribution: Distribution,
    center: number,
    categoryWidth: number,
    y: (value: number) => number,
    top: number,
    plotHeight: number,
    viewport: powerbi.IViewport,
    fits: TextFit[],
  ): void {
    const categorySelected = distribution.selected
      || distribution.observations.some((observation) => observation.selected);
    const categoryHighlighted = distribution.highlighted
      || distribution.observations.some((observation) => observation.highlighted);
    const classes = [
      "atlyn-category",
      categorySelected ? "atlyn-selected" : "",
      categoryHighlighted ? "atlyn-highlighted" : "",
    ].filter(Boolean).join(" ");
    const group = svgElement("g", {
      class: classes,
      role: "button",
      tabindex: "0",
      "data-category": distribution.category,
      "data-category-key": distribution.categorySelectionKey ?? distribution.category,
      "aria-label": this.accessibleDistributionLabel(distribution),
      "aria-selected": String(categorySelected),
      "data-selected": String(categorySelected),
      "data-highlighted": String(categoryHighlighted),
    });
    if (this.lastModel?.hasHighlights && !categoryHighlighted) {
      group.setAttribute("opacity", "0.4");
    }
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      this.select(distribution.categorySelectionKey, distribution.categorySelectionId, event);
    });
    group.addEventListener("contextmenu", (event) => {
      if (!this.allowInteractions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(distribution.categorySelectionId ?? distribution.observations[0]?.selectionId, event);
    });
    group.addEventListener("mouseenter", (event) => this.showTooltip(distribution, undefined, event, false));
    group.addEventListener("mousemove", (event) => this.moveTooltip(event, false));
    group.addEventListener("mouseleave", () => this.hideTooltip(false));
    this.attachTouchInteractions(
      group,
      (event) => this.showTooltip(distribution, undefined, event, true),
      (event) => this.moveTooltip(event, true),
      distribution.categorySelectionId ?? distribution.observations[0]?.selectionId,
    );

    // The widest half-extent any glyph in this category may occupy without leaving the
    // tile. Every "comfortable minimum" below is capped by it: a 36px touch target and a
    // 28px box are sensible defaults and impossible demands at the same time, depending
    // on the tile, and a floor that cannot shrink is exactly how content ends up outside
    // a clipped root.
    const slotHalf = Math.max(
      1,
      Math.min(categoryWidth * 0.5, center - 1, viewport.width - center - 1),
    );

    const hitHalf = Math.min(Math.max(18, categoryWidth * 0.48), slotHalf);
    const hitArea = svgElement("rect", {
      x: String(center - hitHalf),
      y: String(top),
      width: String(hitHalf * 2),
      height: String(plotHeight),
      fill: "transparent",
      "aria-hidden": "true",
    });
    group.appendChild(hitArea);

    const labelSize = this.root.classList.contains("atlyn-mobile")
      ? Math.min(11, this.labelSize)
      : this.labelSize;
    const label = svgElement("text", {
      class: "atlyn-category-label",
      x: String(center),
      y: String(top + plotHeight + 26),
      "text-anchor": "middle",
      fill: "currentColor",
      "font-size": String(labelSize),
      direction: this.rtl ? "rtl" : "ltr",
    });
    label.textContent = distribution.category;
    group.appendChild(label);
    fits.push({
      element: label,
      maxWidth: Math.max(0, slotHalf * 2 - 2),
      maxLines: 1,
      lineHeight: labelSize * 1.2,
      maxBottom: viewport.height - 1,
    });

    if (!distribution.statistics) {
      const stateText = svgElement("text", {
        class: "atlyn-state-label",
        x: String(center),
        y: String(top + plotHeight / 2),
        "text-anchor": "middle",
        fill: "currentColor",
        "font-size": "11",
      });
      stateText.textContent = distribution.state === "invalid" ? this.t("invalid") : this.t("noData");
      group.appendChild(stateText);
      fits.push({
        element: stateText,
        maxWidth: Math.max(0, slotHalf * 2 - 2),
        maxLines: Math.max(1, Math.min(3, Math.floor(plotHeight / 14))),
        lineHeight: 13,
        centerOn: top + plotHeight / 2,
      });
      this.svg.appendChild(group);
      return;
    }

    const stats = distribution.statistics;
    const boxWidth = Math.min(64, Math.max(28, categoryWidth * 0.55), slotHalf * 2);
    const box = svgElement("rect", {
      class: "atlyn-box",
      x: String(center - boxWidth / 2),
      y: String(y(stats.q3)),
      width: String(boxWidth),
      height: String(Math.max(2, y(stats.q1) - y(stats.q3))),
      fill: "var(--atlyn-box)",
      stroke: "var(--atlyn-foreground)",
      "stroke-width": this.host.colorPalette?.isHighContrast === true ? "2" : "1.5",
    });
    group.appendChild(box);

    const whisker = svgElement("line", {
      x1: String(center),
      x2: String(center),
      y1: String(y(stats.upperWhisker)),
      y2: String(y(stats.lowerWhisker)),
      stroke: "var(--atlyn-foreground)",
      "stroke-width": this.host.colorPalette?.isHighContrast === true ? "2" : "1.5",
    });
    group.appendChild(whisker);
    [stats.upperWhisker, stats.lowerWhisker].forEach((whiskerValue) => {
      group.appendChild(svgElement("line", {
        x1: String(center - boxWidth * 0.3),
        x2: String(center + boxWidth * 0.3),
        y1: String(y(whiskerValue)),
        y2: String(y(whiskerValue)),
        stroke: "var(--atlyn-foreground)",
        "stroke-width": this.host.colorPalette?.isHighContrast === true ? "2" : "1.5",
      }));
    });
    group.appendChild(svgElement("line", {
      x1: String(center - boxWidth / 2),
      x2: String(center + boxWidth / 2),
      y1: String(y(stats.median)),
      y2: String(y(stats.median)),
      stroke: "var(--atlyn-selected)",
      "stroke-width": "3",
    }));

    // The mean cross, the observation dots and the outlier dots all carry their own
    // minimum sizes. Each is capped by the slot so a comfortable default on a large tile
    // cannot become an escaping glyph on a small one.
    const meanHalf = Math.max(1, Math.min(this.markerSize, slotHalf - 1));
    const meanY = y(stats.mean);
    const meanMarker = svgElement("path", {
      d: `M ${center - meanHalf} ${meanY - meanHalf} L ${center + meanHalf} ${meanY + meanHalf} M ${center + meanHalf} ${meanY - meanHalf} L ${center - meanHalf} ${meanY + meanHalf}`,
      stroke: "var(--atlyn-foreground)",
      "stroke-width": "2",
      "aria-label": `${this.t("mean")}: ${this.formatNumber(stats.mean, distribution.valueFormat)}`,
    });
    if (this.showMean) {
      group.appendChild(meanMarker);
    }

    let observationIndex = 0;
    for (const observation of distribution.observations) {
      if (!(observation.highlighted || observation.selected)) {
        continue;
      }
      if (observationIndex >= MAX_RENDERED_MARKERS_PER_DISTRIBUTION) {
        break;
      }
      this.renderObservationMarker(group, distribution, observation, center, y, boxWidth, observationIndex, slotHalf);
      observationIndex += 1;
    }

    if (this.showOutliers) {
      distribution.outliers.slice(0, MAX_RENDERED_MARKERS_PER_DISTRIBUTION).forEach((outlier, outlierIndex) => {
        this.renderOutlier(group, distribution, outlier, center, y, boxWidth, outlierIndex, slotHalf);
      });
    }

    const stateText = distribution.state === "small-sample" ? svgElement("text", {
      class: "atlyn-state-label",
      x: String(center),
      y: String(top + 12),
      "text-anchor": "middle",
      fill: "currentColor",
      "font-size": "9",
    }) : undefined;
    if (stateText) {
      stateText.textContent = this.t("smallSample");
      group.appendChild(stateText);
      fits.push({
        element: stateText,
        maxWidth: Math.max(0, slotHalf * 2 - 2),
        maxLines: Math.max(1, Math.min(3, Math.floor(plotHeight / 12))),
        lineHeight: 11,
      });
    }
    this.svg.appendChild(group);
  }

  private renderObservationMarker(
    group: SVGGElement,
    distribution: Distribution,
    observation: ValidObservation,
    center: number,
    y: (value: number) => number,
    boxWidth: number,
    observationIndex: number,
    slotHalf: number,
  ): void {
    const jitter = ((observation.originalIndex * 13 + observationIndex * 7) % 7 - 3) * Math.min(3, boxWidth / 12);
    const radius = Math.max(1, Math.min(Math.max(this.markerSize + 3, 8), slotHalf - Math.abs(jitter) - 1));
    const marker = svgElement("circle", {
      class: [
        "atlyn-observation",
        observation.selected ? "atlyn-selected" : "",
        observation.highlighted ? "atlyn-highlight" : "",
      ].filter(Boolean).join(" "),
      cx: String(center + jitter),
      cy: String(y(observation.value)),
      r: String(radius),
      fill: observation.selected ? "var(--atlyn-selected)" : "var(--atlyn-background)",
      "fill-opacity": observation.selected ? "0.2" : "1",
      stroke: observation.selected ? "var(--atlyn-selected)" : "var(--atlyn-foreground)",
      "stroke-width": this.host.colorPalette?.isHighContrast === true ? "2" : "1.5",
    });
    if (observation.highlighted && !observation.selected) {
      marker.setAttribute("stroke-dasharray", "3 2");
    }
    this.decorateDataPoint(marker, observation, `${this.t("sample")}: ${observation.sample}; ${this.t("value")}: ${this.formatNumber(observation.value, observation.valueFormat)}`);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      this.select(observation.selectionKey, observation.selectionId, event);
    });
    marker.addEventListener("contextmenu", (event) => {
      if (!this.allowInteractions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(observation.selectionId, event);
    });
    marker.addEventListener("mouseenter", (event) => this.showTooltip(distribution, observation, event, false));
    marker.addEventListener("mousemove", (event) => {
      event.stopPropagation();
      this.moveTooltip(event, false);
    });
    marker.addEventListener("mouseleave", () => this.hideTooltip(false));
    this.attachTouchInteractions(
      marker,
      (event) => this.showTooltip(distribution, observation, event, true),
      (event) => this.moveTooltip(event, true),
      observation.selectionId,
    );
    group.appendChild(marker);
  }

  private renderOutlier(
    group: SVGGElement,
    distribution: Distribution,
    outlier: Outlier,
    center: number,
    y: (value: number) => number,
    boxWidth: number,
    outlierIndex: number,
    slotHalf: number,
  ): void {
    const jitter = ((outlier.originalIndex * 17 + outlierIndex * 11) % 7 - 3) * Math.min(3, boxWidth / 12);
    const x = center + jitter;
    const radius = Math.max(1, Math.min(Math.max(this.markerSize, 5), slotHalf - Math.abs(jitter) - 1));
    const marker = this.host.colorPalette?.isHighContrast === true
      ? svgElement("path", {
        d: `M ${x} ${y(outlier.value) - radius} L ${x + radius} ${y(outlier.value)} L ${x} ${y(outlier.value) + radius} L ${x - radius} ${y(outlier.value)} Z`,
      })
      : svgElement("circle", {
        cx: String(x),
        cy: String(y(outlier.value)),
        r: String(radius),
      });
    marker.setAttribute("class", [
      "atlyn-outlier",
      outlier.selected ? "atlyn-selected" : "",
      outlier.highlighted ? "atlyn-highlight" : "",
    ].filter(Boolean).join(" "));
    marker.setAttribute("fill", "var(--atlyn-outlier)");
    marker.setAttribute("stroke", "var(--atlyn-foreground)");
    marker.setAttribute("stroke-width", this.host.colorPalette?.isHighContrast === true ? "2" : "1.5");
    if (outlier.highlighted && !outlier.selected) {
      marker.setAttribute("stroke-dasharray", "3 2");
    }
    marker.setAttribute("data-sample", outlier.sample);
    this.decorateDataPoint(marker, outlier, `${this.t("sample")}: ${outlier.sample}; ${this.t("value")}: ${this.formatNumber(outlier.value, outlier.valueFormat)}`);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      this.select(outlier.selectionKey, outlier.selectionId, event);
    });
    marker.addEventListener("contextmenu", (event) => {
      if (!this.allowInteractions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(outlier.selectionId, event);
    });
    marker.addEventListener("mouseenter", (event) => this.showTooltip(
      distribution,
      outlier,
      event,
      false,
    ));
    marker.addEventListener("mousemove", (event) => {
      event.stopPropagation();
      this.moveTooltip(event, false);
    });
    marker.addEventListener("mouseleave", () => this.hideTooltip(false));
    this.attachTouchInteractions(
      marker,
      (event) => this.showTooltip(distribution, outlier, event, true),
      (event) => this.moveTooltip(event, true),
      outlier.selectionId,
    );
    group.appendChild(marker);
  }

  private decorateDataPoint(
    element: SVGElement,
    observation: ValidObservation | Outlier,
    ariaLabel: string,
  ): void {
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("data-category", observation.category);
    element.setAttribute("data-category-key", observation.categorySelectionKey ?? observation.category);
    element.setAttribute("data-original-index", String(observation.originalIndex));
    element.setAttribute("aria-label", ariaLabel);
    element.setAttribute("aria-selected", String(observation.selected));
    element.setAttribute("data-selected", String(observation.selected));
    element.setAttribute("data-highlighted", String(observation.highlighted));
    if (observation.selectionKey) {
      element.setAttribute("data-selection-key", observation.selectionKey);
    }
  }

  private attachTouchInteractions(
    element: Element,
    show: (event: TouchEvent) => void,
    move: (event: TouchEvent) => void,
    selectionId: SelectionId | undefined,
  ): void {
    let timer: number | undefined;
    let longPress = false;
    let startX = 0;
    let startY = 0;

    const clear = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.touchTimers.delete(timer);
        timer = undefined;
      }
    };

    element.addEventListener("touchstart", (event: Event) => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches[0];
      if (!touch) {
        return;
      }
      clear();
      longPress = false;
      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        timer = undefined;
        longPress = true;
        show(touchEvent);
        this.showContextMenu(selectionId, touchEvent, false);
      }, 550);
      this.touchTimers.add(timer);
    }, { passive: true });

    element.addEventListener("touchmove", (event: Event) => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches[0];
      if (!touch) {
        return;
      }
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
        clear();
        return;
      }
      if (longPress) {
        move(touchEvent);
      }
    }, { passive: true });

    element.addEventListener("touchend", () => {
      clear();
      if (longPress) {
        this.hideTooltip(true);
      }
      longPress = false;
    }, { passive: true });
    element.addEventListener("touchcancel", () => {
      clear();
      this.hideTooltip(true);
      longPress = false;
    }, { passive: true });
  }

  private clearTouchTimers(): void {
    this.touchTimers.forEach((timer) => window.clearTimeout(timer));
    this.touchTimers.clear();
  }

  private renderSummaryTable(model: DistributionModel): void {
    while (this.summaryTable.firstChild) {
      this.summaryTable.removeChild(this.summaryTable.firstChild);
    }
    const headers = [
      this.t("category"),
      this.t("sampleCount"),
      this.t("q1"),
      this.t("median"),
      this.t("q3"),
      this.t("mean"),
      this.t("iqr"),
      this.t("lowerFence"),
      this.t("upperFence"),
      this.t("lowerWhisker"),
      this.t("upperWhisker"),
      this.t("outliers"),
    ];
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((header) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = header;
      headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    this.summaryTable.appendChild(head);
    const body = document.createElement("tbody");
    model.distributions.forEach((distribution) => {
      const row = document.createElement("tr");
      const values = distribution.statistics
        ? [
          distribution.category,
          String(distribution.statistics.n),
          this.formatNumber(distribution.statistics.q1, distribution.valueFormat),
          this.formatNumber(distribution.statistics.median, distribution.valueFormat),
          this.formatNumber(distribution.statistics.q3, distribution.valueFormat),
          this.formatNumber(distribution.statistics.mean, distribution.valueFormat),
          this.formatNumber(distribution.statistics.iqr, distribution.valueFormat),
          this.formatNumber(distribution.statistics.lowerFence, distribution.valueFormat),
          this.formatNumber(distribution.statistics.upperFence, distribution.valueFormat),
          this.formatNumber(distribution.statistics.lowerWhisker, distribution.valueFormat),
          this.formatNumber(distribution.statistics.upperWhisker, distribution.valueFormat),
          String(distribution.outliers.length),
        ]
        : [distribution.category, "0", "—", "—", "—", "—", "—", "—", "—", "—", "—", "0"];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    if (model.distributions.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = headers.length;
      cell.textContent = this.t("noData");
      row.appendChild(cell);
      body.appendChild(row);
    }
    this.summaryTable.appendChild(body);
  }

  private accessibleDistributionLabel(distribution: Distribution): string {
    if (!distribution.statistics) {
      return `${distribution.category}: ${this.t("invalid")}`;
    }
    const stats = distribution.statistics;
    const smallSample = distribution.state === "small-sample" ? `; ${this.t("smallSample")}` : "";
    return `${distribution.category}; ${this.t("sampleCount")} ${stats.n}; ${this.t("q1")} ${this.formatNumber(stats.q1, distribution.valueFormat)}; ${this.t("median")} ${this.formatNumber(stats.median, distribution.valueFormat)}; ${this.t("q3")} ${this.formatNumber(stats.q3, distribution.valueFormat)}; ${this.t("mean")} ${this.formatNumber(stats.mean, distribution.valueFormat)}; ${this.t("iqr")} ${this.formatNumber(stats.iqr, distribution.valueFormat)}; ${this.t("lowerFence")} ${this.formatNumber(stats.lowerFence, distribution.valueFormat)}; ${this.t("upperFence")} ${this.formatNumber(stats.upperFence, distribution.valueFormat)}; ${this.t("lowerWhisker")} ${this.formatNumber(stats.lowerWhisker, distribution.valueFormat)}; ${this.t("upperWhisker")} ${this.formatNumber(stats.upperWhisker, distribution.valueFormat)}; ${this.t("outliers")} ${distribution.outliers.length}; ${this.t("method")} ${this.t("type7")}; ${this.t("rule")} ${this.t("tukey")}${smallSample}`;
  }

  private showTooltip(
    distribution: Distribution | undefined,
    observation: ValidObservation | Outlier | undefined,
    event: Event,
    isTouchEvent: boolean,
  ): void {
    if (!distribution) {
      return;
    }
    if (!this.host.tooltipService?.enabled?.()) {
      return;
    }
    const stats = distribution.statistics;
    const items: powerbi.extensibility.VisualTooltipDataItem[] = [
      { displayName: this.t("category"), value: distribution.category },
      { displayName: this.t("sampleCount"), value: stats ? String(stats.n) : "0" },
      ...(stats ? [
        { displayName: this.t("q1"), value: this.formatNumber(stats.q1, distribution.valueFormat) },
        { displayName: this.t("median"), value: this.formatNumber(stats.median, distribution.valueFormat) },
        { displayName: this.t("q3"), value: this.formatNumber(stats.q3, distribution.valueFormat) },
        { displayName: this.t("mean"), value: this.formatNumber(stats.mean, distribution.valueFormat) },
        { displayName: this.t("iqr"), value: this.formatNumber(stats.iqr, distribution.valueFormat) },
        { displayName: this.t("lowerFence"), value: this.formatNumber(stats.lowerFence, distribution.valueFormat) },
        { displayName: this.t("upperFence"), value: this.formatNumber(stats.upperFence, distribution.valueFormat) },
        { displayName: this.t("lowerWhisker"), value: this.formatNumber(stats.lowerWhisker, distribution.valueFormat) },
        { displayName: this.t("upperWhisker"), value: this.formatNumber(stats.upperWhisker, distribution.valueFormat) },
        { displayName: this.t("outliers"), value: String(distribution.outliers.length) },
        { displayName: this.t("method"), value: this.t("type7") },
        { displayName: this.t("rule"), value: this.t("tukey") },
      ] : []),
      ...(observation ? [
        { displayName: this.t("sample"), value: observation.sample },
        { displayName: this.t("value"), value: this.formatNumber(observation.value, observation.valueFormat) },
        ...observation.tooltipValues.map((tooltip) => ({
          displayName: tooltip.label,
          value: this.formatValue(tooltip.value, tooltip.format),
        })),
      ] : []),
      {
        displayName: this.t("diagnostics"),
        value: this.lastModel ? this.diagnosticsLabel(this.lastModel) : "",
      },
    ];
    const identity = observation?.selectionId ?? distribution.categorySelectionId ?? distribution.observations[0]?.selectionId;
    const identities = identity ? [identity] : [];
    this.activeTooltip = { dataItems: items, identities };
    this.host.tooltipService.show({
      dataItems: items,
      identities,
      coordinates: this.eventCoordinates(event),
      isTouchEvent,
    });
  }

  private moveTooltip(event: Event, isTouchEvent: boolean): void {
    if (!this.activeTooltip || !this.host.tooltipService?.enabled?.()) {
      return;
    }
    this.host.tooltipService.move({
      dataItems: this.activeTooltip.dataItems,
      identities: this.activeTooltip.identities,
      coordinates: this.eventCoordinates(event),
      isTouchEvent,
    });
  }

  private hideTooltip(isTouchEvent: boolean, immediately = false): void {
    this.activeTooltip = undefined;
    this.host.tooltipService?.hide?.({ isTouchEvent, immediately });
  }

  private eventCoordinates(event: Event): [number, number] {
    const touchEvent = event as TouchEvent;
    const touch = touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0];
    if (touch) {
      return [touch.clientX, touch.clientY];
    }
    const pointerEvent = event as MouseEvent;
    if (finite(pointerEvent.clientX) && finite(pointerEvent.clientY)) {
      return [pointerEvent.clientX, pointerEvent.clientY];
    }
    const target = event.target as Element | null;
    const rect = target?.getBoundingClientRect?.() ?? this.root.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  }

  private formatNumber(value: number, format?: string): string {
    return this.formatValue(value, format);
  }

  private formatValue(value: unknown, format?: string): string {
    if (value === null || value === undefined) {
      return "";
    }
    return valueFormatter.format(value, format, false, this.locale);
  }

  private select(selectionKey: string | undefined, selectionId: SelectionId | undefined, event: Event): void {
    if (!this.allowInteractions) {
      return;
    }
    const id = selectionId ?? this.lastModel?.distributions
      .flatMap((distribution) => distribution.observations)
      .find((observation) => observation.selectionKey === selectionKey)?.selectionId
      ?? this.lastModel?.distributions.find((distribution) => distribution.selectionKey === selectionKey)?.observations[0]?.selectionId;
    if (id) {
      const pointerEvent = event as MouseEvent & KeyboardEvent;
      this.selectionManager.select(id, Boolean(pointerEvent.ctrlKey || pointerEvent.metaKey));
    }
  }

  private showContextMenu(selectionId: SelectionId | undefined, event: Event, preventDefault = true): void {
    if (!this.allowInteractions) {
      return;
    }
    if (preventDefault) {
      event.preventDefault();
    }
    const id = selectionId ?? this.host.createSelectionIdBuilder().createSelectionId();
    this.selectionManager.showContextMenu(id, {
      x: this.eventCoordinates(event)[0],
      y: this.eventCoordinates(event)[1],
    });
  }

  private readonly handleCanvasClick = (event: MouseEvent): void => {
    if (!isDataPointTarget(event.target)) {
      if (this.allowInteractions) {
        this.selectionManager.clear();
      }
      this.hideTooltip(false);
    }
  };

  private readonly handleCanvasContextMenu = (event: MouseEvent): void => {
    if (this.allowInteractions && !isDataPointTarget(event.target)) {
      this.showContextMenu(undefined, event);
    }
  };

  private readonly handleCanvasLeave = (): void => {
    this.hideTooltip(false);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const categories = Array.from(this.root.querySelectorAll<SVGGElement>(".atlyn-category"));
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.allowInteractions) {
        this.selectionManager.clear();
      }
      this.hideTooltip(false);
      this.root.focus();
      return;
    }
    const active = document.activeElement as Element | null;
    if (event.key === "Enter" && active === this.root && categories.length > 0) {
      event.preventDefault();
      categories[0].focus();
      return;
    }
    const focusableDataPoints = Array.from(this.root.querySelectorAll<SVGElement>(
      ".atlyn-category, .atlyn-observation, .atlyn-outlier",
    ));
    const activeIndex = active
      ? focusableDataPoints.findIndex((focusable) => focusable === active)
      : -1;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && focusableDataPoints.length > 0) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const logicalDirection = this.rtl ? -direction : direction;
      const nextIndex = (activeIndex < 0 ? 0 : activeIndex + logicalDirection + focusableDataPoints.length) % focusableDataPoints.length;
      focusableDataPoints[nextIndex].focus();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && activeIndex >= 0) {
      event.preventDefault();
      const categoryKey = active?.getAttribute("data-category-key");
      const category = this.lastModel?.distributions.find((item) => (
        (item.categorySelectionKey ?? item.category) === categoryKey
      ));
      if (category) {
        if (active?.classList.contains("atlyn-category")) {
          this.select(category.categorySelectionKey, category.categorySelectionId, event);
          return;
        }
        const originalIndex = Number(active?.getAttribute("data-original-index"));
        const observation = category.observations.find((item) => item.originalIndex === originalIndex);
        if (observation) {
          this.select(observation.selectionKey, observation.selectionId, event);
        }
      }
    }
  };
}
