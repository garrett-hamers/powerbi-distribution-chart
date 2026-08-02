import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")) as {
  dataRoles: Array<{ name: string; displayNameKey?: string }>;
  dataViewMappings: Array<{ conditions: Array<Record<string, { min?: number; max?: number }>> }>;
  privileges: unknown[];
  supportsHighlight: boolean;
  tooltips: unknown;
  objects: {
    general: {
      properties: Record<string, {
        displayNameKey?: string;
        type: { numeric?: boolean };
      }>;
    };
  };
};

describe("certification-first package contract", () => {
  test("declares stable visual metadata, roles, bounded reduction, and no privileges", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const roleNames = capabilities.dataRoles.map((role: { name: string }) => role.name);

    expect(capabilities.privileges).toEqual([]);
    expect(roleNames).toEqual(["Category", "Sample", "Value", "Tooltips"]);
    expect(capabilities.supportsHighlight).toBe(true);
    expect(JSON.stringify(capabilities)).toContain('"count":30000');
    expect(capabilities.dataViewMappings[0].conditions[0]).toMatchObject({
      Category: { min: 1, max: 1 },
      Sample: { min: 1, max: 1 },
      Value: { min: 1, max: 1 },
    });
    expect(capabilities.tooltips).toEqual({
      supportedTypes: { default: true },
      roles: ["Tooltips"],
    });
    expect(capabilities.dataRoles.every((role: { displayNameKey?: string }) => role.displayNameKey)).toBe(true);
    expect(capabilities.objects.general.properties.markerSize.type.numeric).toBe(true);
    expect(pbiviz.visual.guid).toBe("atlynDistributionA1B2C3D4E5F6G7H8I9J0");
    expect(pbiviz.apiVersion).toBe("5.11.0");
    expect(pbiviz.visual.version).toBe("1.0.0.0");
  });

  test("keeps localization resources aligned with capabilities display-name keys", () => {
    const resources = JSON.parse(fs.readFileSync(
      path.join(root, "stringResources", "en-US", "resources.resjson"),
      "utf8",
    )) as Record<string, string>;
    const requiredKeys = [
      ...capabilities.dataRoles.map((role) => role.displayNameKey),
      ...Object.values(capabilities.objects.general.properties)
        .map((property) => property.displayNameKey),
    ].filter((key): key is string => Boolean(key));

    requiredKeys.forEach((key) => expect(resources[key]).toBeTruthy());
  });

  test("keeps every packaged locale aligned with the canonical resource key set", () => {
    const resourceRoot = path.join(root, "stringResources");
    const canonical = JSON.parse(fs.readFileSync(
      path.join(resourceRoot, "en-US", "resources.resjson"),
      "utf8",
    )) as Record<string, string>;
    const canonicalKeys = Object.keys(canonical).sort();

    fs.readdirSync(resourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "en-US")
      .forEach((entry) => {
        const locale = JSON.parse(fs.readFileSync(
          path.join(resourceRoot, entry.name, "resources.resjson"),
          "utf8",
        )) as Record<string, string>;
        expect(Object.keys(locale).sort()).toEqual(canonicalKeys);
      });
  });

  test("does not include network access or forbidden unsafe APIs", () => {
    const sourceFiles = fs.readdirSync(path.join(root, "src")).map((file) => (
      fs.readFileSync(path.join(root, "src", file), "utf8")
    )).join("\n");
    expect(sourceFiles).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|eval|Function)\b/);
    expect(sourceFiles).not.toContain("innerHTML");
    expect(sourceFiles).not.toContain("outerHTML");
    expect(sourceFiles).not.toContain("document.write");
  });
});
