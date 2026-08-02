const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const COMPRESSION_LEVEL = 6;

function findPackagePath(rootPath = process.cwd()) {
  const distPath = path.join(rootPath, "dist");
  const manifestPath = path.join(distPath, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedName = `${manifest.visual.guid}.${manifest.version}.pbiviz`;
  const packageFiles = fs.readdirSync(distPath).filter((file) => file.endsWith(".pbiviz"));

  if (packageFiles.length !== 1 || packageFiles[0] !== expectedName) {
    throw new Error(`Expected exactly one current package (${expectedName}) in ${distPath}`);
  }

  return path.join(distPath, expectedName);
}

async function normalizePackage(packagePath) {
  const source = fs.readFileSync(packagePath);
  const input = await JSZip.loadAsync(source);
  const output = new JSZip();

  for (const name of Object.keys(input.files).sort()) {
    const entry = input.files[name];
    if (entry.dir) {
      output.file(name, null, { dir: true, date: FIXED_ZIP_DATE });
      continue;
    }

    const contents = await entry.async("nodebuffer");
    output.file(name, contents, {
      compression: "DEFLATE",
      compressionOptions: { level: COMPRESSION_LEVEL },
      date: FIXED_ZIP_DATE,
    });
  }

  const normalized = await output.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: COMPRESSION_LEVEL },
    platform: "DOS",
    type: "nodebuffer",
  });
  const temporaryPath = `${packagePath}.tmp`;
  fs.writeFileSync(temporaryPath, normalized);
  fs.renameSync(temporaryPath, packagePath);
}

if (require.main === module) {
  normalizePackage(findPackagePath()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { FIXED_ZIP_DATE, findPackagePath, normalizePackage };
