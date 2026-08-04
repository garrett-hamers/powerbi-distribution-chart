import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const SAMPLE_SLUG = "atlyn-distribution-sample";
const SAMPLE_ROOT = path.join(root, "samples");
const REPORT_ROOT = path.join(SAMPLE_ROOT, `${SAMPLE_SLUG}.Report`);
const MODEL_ROOT = path.join(SAMPLE_ROOT, `${SAMPLE_SLUG}.SemanticModel`);
const GUID = "atlynDistributionA1B2C3D4E5F6G7H8I9J0";

const readJson = <T>(...segments: string[]): T => (
  JSON.parse(fs.readFileSync(path.join(...segments), "utf8")) as T
);

const capabilities = readJson<{ dataRoles: Array<{ name: string }> }>(root, "capabilities.json");
const roleNames = new Set(capabilities.dataRoles.map((role) => role.name));

function findVisualFile(): string {
  const pagesRoot = path.join(REPORT_ROOT, "definition", "pages");
  const pageIds = fs.readdirSync(pagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(pageIds).toHaveLength(1);

  const visualsRoot = path.join(pagesRoot, pageIds[0], "visuals");
  const visualIds = fs.readdirSync(visualsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(visualIds).toHaveLength(1);

  return path.join(visualsRoot, visualIds[0], "visual.json");
}

describe("offline sample report project", () => {
  test("ships every required PBIP, PBIR, and TMDL part", () => {
    [
      [SAMPLE_ROOT, `${SAMPLE_SLUG}.pbip`],
      [REPORT_ROOT, ".platform"],
      [REPORT_ROOT, "definition.pbir"],
      [REPORT_ROOT, "definition", "version.json"],
      [REPORT_ROOT, "definition", "report.json"],
      [REPORT_ROOT, "definition", "pages", "pages.json"],
      [MODEL_ROOT, ".platform"],
      [MODEL_ROOT, "definition.pbism"],
      [MODEL_ROOT, "definition", "database.tmdl"],
      [MODEL_ROOT, "definition", "model.tmdl"],
      [MODEL_ROOT, "definition", "tables", "Measurements.tmdl"],
    ].forEach((segments) => expect(fs.existsSync(path.join(...segments))).toBe(true));

    expect(fs.existsSync(findVisualFile())).toBe(true);
  });

  test("points the PBIP and PBIR at the report and semantic model folders", () => {
    const pbip = readJson<{ version: string; artifacts: Array<{ report: { path: string } }> }>(
      SAMPLE_ROOT,
      `${SAMPLE_SLUG}.pbip`,
    );
    expect(pbip.artifacts).toEqual([{ report: { path: `${SAMPLE_SLUG}.Report` } }]);

    const pbir = readJson<{ version: string; datasetReference: { byPath: { path: string } } }>(
      REPORT_ROOT,
      "definition.pbir",
    );
    expect(pbir.version).toBe("4.0");
    expect(pbir.datasetReference.byPath.path).toBe(`../${SAMPLE_SLUG}.SemanticModel`);
  });

  test("binds the visual to the frozen GUID using only declared data roles", () => {
    const visual = readJson<{
      name: string;
      visual: {
        visualType: string;
        query: { queryState: Record<string, { projections: Array<Record<string, unknown>> }> };
      };
    }>(findVisualFile());

    expect(visual.visual.visualType).toBe(GUID);

    const queryState = visual.visual.query.queryState;
    const stateKeys = Object.keys(queryState);
    expect(stateKeys).toEqual(["Category", "Sample", "Value"]);
    stateKeys.forEach((key) => expect(roleNames.has(key)).toBe(true));
    stateKeys.forEach((key) => expect(queryState[key].projections.length).toBeGreaterThan(0));
  });

  test("projects raw columns rather than aggregates", () => {
    const contents = fs.readFileSync(findVisualFile(), "utf8");
    // Atlyn Distribution plots raw observations; an aggregated Value would break its contract.
    expect(contents).not.toContain("Aggregation");
    expect(contents).toContain('"Property": "Value"');
    expect(contents).toContain('"Entity": "Measurements"');
  });

  test("embeds the built visual instead of resolving it from AppSource", () => {
    const report = readJson<{
      publicCustomVisuals?: string[];
      resourcePackages: Array<{
        name: string;
        type: string;
        items: Array<{ name: string; path: string; type: string }>;
      }>;
    }>(REPORT_ROOT, "definition", "report.json");

    expect(report.publicCustomVisuals).toBeUndefined();

    const customVisual = report.resourcePackages.find((entry) => entry.type === "CustomVisual");
    expect(customVisual).toBeDefined();
    expect(customVisual?.name).toBe(GUID);
    expect(customVisual?.items).toEqual([{
      name: `${GUID}.pbiviz.json`,
      path: `${GUID}.pbiviz.json`,
      type: "CustomVisualMetadata",
    }]);

    const embeddedRoot = path.join(REPORT_ROOT, "CustomVisuals", GUID);
    expect(fs.existsSync(path.join(embeddedRoot, "package.json"))).toBe(true);

    const resourcePath = path.join(embeddedRoot, "resources", `${GUID}.pbiviz.json`);
    expect(fs.existsSync(resourcePath)).toBe(true);

    const resource = JSON.parse(fs.readFileSync(resourcePath, "utf8")) as {
      visual: { guid: string };
      content: { js: string };
    };
    expect(resource.visual.guid).toBe(GUID);
    expect(resource.content.js.length).toBeGreaterThan(50000);
  });

  test("loads its data from inline literals with no external data source", () => {
    const tmdl = fs.readFileSync(
      path.join(MODEL_ROOT, "definition", "tables", "Measurements.tmdl"),
      "utf8",
    );

    [
      "Sql.Database",
      "Web.Contents",
      "File.Contents",
      "Csv.Document",
      "Excel.Workbook",
      "OData.Feed",
      "Folder.Files",
      "SharePoint",
      "Odbc.",
    ].forEach((token) => expect(tmdl).not.toContain(token));
    expect(tmdl).not.toMatch(/\bhttps?:\/\//);

    expect(tmdl).toContain("mode: import");
    expect(tmdl).toContain("#table(");
    expect(tmdl).toContain("type table [Category = text, Sample = text, Value = number]");
    // Don't summarize, so the visual receives raw observations.
    expect(tmdl).toContain("summarizeBy: none");
  });

  test("carries exactly the rows of the committed sample dataset", () => {
    const tmdl = fs.readFileSync(
      path.join(MODEL_ROOT, "definition", "tables", "Measurements.tmdl"),
      "utf8",
    );
    const literals = tmdl.split(/\r?\n/)
      .map((line) => /^\s*\{"([^"]+)", "([^"]+)", (-?\d+\.\d+)\},?$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => `${match[1]},${match[2]},${match[3]}`);

    const csv = fs.readFileSync(
      path.join(root, "assets", "sample-data", "atlyn-distribution-sample.csv"),
      "utf8",
    ).trim().split(/\r?\n/).slice(1);

    expect(literals).toHaveLength(200);
    expect(literals).toEqual(csv);
  });
});
