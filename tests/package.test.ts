import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("certification-first package contract", () => {
  test("declares stable visual metadata, roles, bounded reduction, and no privileges", () => {
    const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8"));
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const roleNames = capabilities.dataRoles.map((role: { name: string }) => role.name);

    expect(capabilities.privileges).toEqual([]);
    expect(roleNames).toEqual(["Category", "Sample", "Value", "Tooltips"]);
    expect(capabilities.supportsHighlight).toBe(true);
    expect(JSON.stringify(capabilities)).toContain('"count":30000');
    expect(pbiviz.visual.guid).toBe("atlynDistributionA1B2C3D4E5F6G7H8I9J0");
    expect(pbiviz.apiVersion).toBe("5.11.0");
    expect(pbiviz.visual.version).toBe("1.0.0.0");
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
