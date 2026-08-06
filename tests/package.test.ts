import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const { FIXED_ZIP_DATE, normalizePackage } = require("../scripts/normalize-pbiviz");

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
  test("normalizes ZIP metadata for reproducible package hashes", async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atlyn-package-"));
    const firstPath = path.join(temporaryRoot, "first.pbiviz");
    const secondPath = path.join(temporaryRoot, "second.pbiviz");
    const createPackage = async (outputPath: string, date: Date) => {
      const zip = new JSZip();
      zip.file("package.json", "{}", { date });
      zip.file("resources/entry.txt", "payload", { date });
      fs.writeFileSync(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
    };

    try {
      await createPackage(firstPath, new Date("2026-08-02T18:00:00Z"));
      await createPackage(secondPath, new Date("2026-08-02T18:01:00Z"));
      await normalizePackage(firstPath);
      await normalizePackage(secondPath);

      const hash = (filePath: string) => createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
      expect(hash(firstPath)).toBe(hash(secondPath));
      const normalized = await JSZip.loadAsync(fs.readFileSync(firstPath));
      expect(Object.values(normalized.files).every((entry) => (
        entry.date.getTime() === FIXED_ZIP_DATE.getTime()
      ))).toBe(true);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("declares stable visual metadata, roles, bounded reduction, and no privileges", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const roleNames = capabilities.dataRoles.map((role: { name: string }) => role.name);
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

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
    expect(pbiviz.visual.version).toBe("1.0.1.1");
    expect(packageJson.scripts.eslint).toBe("eslint .");
    expect(packageJson.scripts["certification-audit"])
      .toBe("npm run package:certification && npm run package && npm run audit:submission");
    expect(packageJson.scripts["audit:submission"]).toBe("node scripts/audit-submission-assets.mjs");
    expect(packageJson.scripts.screenshots).toBe("node scripts/capture-screenshots.mjs");
    expect(packageJson.scripts["sample-data"]).toBe("node scripts/write-sample-dataset.mjs");
    expect(packageJson.scripts["sample-report"]).toBe("node scripts/build-sample-report.mjs");
    expect(packageJson.scripts.icon).toBe("node scripts/build-icon.mjs");
    expect(packageJson.scripts.package).toBe("node scripts/package.mjs");
    expect(packageJson.scripts["package:reproducible"]).toBe("node scripts/verify-reproducible-package.mjs");
    expect(packageJson.scripts["release:metadata"]).toBe("node scripts/release-metadata.mjs");
    expect(packageJson.devDependencies.jszip).toBe("3.10.1");
    expect(packageJson.devDependencies["eslint-plugin-powerbi-visuals"]).toBe("1.1.1");
    expect(packageJson.devDependencies["@typescript-eslint/parser"]).toBe("8.57.2");
  });

  test("uses the visual identity for the exact package filename", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    expect(`${pbiviz.visual.guid}.${pbiviz.visual.version}.pbiviz`)
      .toBe("atlynDistributionA1B2C3D4E5F6G7H8I9J0.1.0.1.1.pbiviz");
  });

  test("keeps package manifest references aligned with checked-in source assets", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as {
      capabilities: string;
      assets: { icon: string };
      externalJS: unknown;
      dependencies: unknown;
    };

    expect(fs.existsSync(path.join(root, pbiviz.capabilities))).toBe(true);
    expect(fs.existsSync(path.join(root, pbiviz.assets.icon))).toBe(true);
    expect(pbiviz.externalJS).toBeNull();
    expect(pbiviz.dependencies).toBeNull();
    expect(fs.existsSync(path.join(root, "src", "visual.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "analytics.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "dataView.ts"))).toBe(true);
  });

  test("ships a 20x20 PNG visual icon referenced by pbiviz.json", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as {
      assets: { icon: string };
    };
    // Microsoft documents the visual icon as a PNG at exactly 20x20. powerbi-visuals-tools
    // does not enforce it and hard-codes assets/icon.png into the packaged manifest
    // regardless of the source extension, so the contract is pinned here.
    expect(pbiviz.assets.icon).toBe("assets/icon.png");

    const icon = fs.readFileSync(path.join(root, "assets", "icon.png"));
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(icon.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(icon.readUInt32BE(16)).toBe(20);
    expect(icon.readUInt32BE(20)).toBe(20);
  });

  test("ships a Partner Center-ready 300x300 PNG logo asset", () => {
    const logoPath = path.join(root, "assets", "logo-300x300.png");
    const logo = fs.readFileSync(logoPath);
    expect(logo.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(logo.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(logo.readUInt32BE(16)).toBe(300);
    expect(logo.readUInt32BE(20)).toBe(300);
  });

  test("declares every AppSource-required pbiviz submission field", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as {
      visual: { name: string; displayName: string; guid: string; version: string; description: string; supportUrl: string };
      author: { name: string; email: string };
    };

    expect(pbiviz.visual.name).toBe("atlynDistribution");
    expect(pbiviz.visual.displayName).toBe("Atlyn Distribution");
    expect(pbiviz.visual.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(pbiviz.visual.description.length).toBeGreaterThanOrEqual(40);
    expect(pbiviz.visual.description.length).toBeLessThanOrEqual(500);
    expect(pbiviz.visual.supportUrl).toBe("https://atlyn.io/contact");
    expect(pbiviz.author.name).toBe("Atlyn");
    expect(pbiviz.author.email).toBe("atlyn.help@gmail.com");
    expect(pbiviz.author.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  test("ships 1-5 listing screenshots at exactly 1366x768 and under 1024 KB", () => {
    const screenshotDirectory = path.join(root, "assets", "screenshots");
    const entries = fs.readdirSync(screenshotDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();

    expect(entries.every((name) => name.endsWith(".png"))).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.length).toBeLessThanOrEqual(5);

    entries.forEach((name) => {
      const screenshot = fs.readFileSync(path.join(screenshotDirectory, name));
      expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(screenshot.subarray(12, 16).toString("ascii")).toBe("IHDR");
      expect(screenshot.readUInt32BE(16)).toBe(1366);
      expect(screenshot.readUInt32BE(20)).toBe(768);
      expect(screenshot.length).toBeLessThanOrEqual(1024 * 1024);
    });
  });

  test("ships the EULA, submission dossier, and offline sample dataset", () => {
    const eula = fs.readFileSync(path.join(root, "EULA.md"), "utf8");
    expect(eula).toContain("https://atlyn.io/legal/privacy");
    expect(eula).toContain("https://atlyn.io/contact");

    const dossier = fs.readFileSync(path.join(root, "docs", "partner-center-submission.md"), "utf8");
    [
      "atlynDistributionA1B2C3D4E5F6G7H8I9J0",
      "https://atlyn.io/contact",
      "https://atlyn.io/legal/privacy",
      "EULA.md",
      "assets/logo-300x300.png",
    ].forEach((token) => expect(dossier).toContain(token));

    const csv = fs.readFileSync(
      path.join(root, "assets", "sample-data", "atlyn-distribution-sample.csv"),
      "utf8",
    ).trim().split(/\r?\n/);
    expect(csv[0]).toBe("Category,Sample,Value");
    expect(csv).toHaveLength(201);
    expect(csv[1]).toMatch(/^Line A,Run 01,-?\d+\.\d$/);
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
