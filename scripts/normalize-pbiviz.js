const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");

const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const COMPRESSION_LEVEL = 9;
const FILE_PERMISSIONS = 0o100644;
const DIRECTORY_PERMISSIONS = 0o40755;

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
      output.file(name, null, {
        date: FIXED_ZIP_DATE,
        dir: true,
        dosPermissions: 0,
        unixPermissions: DIRECTORY_PERMISSIONS,
      });
      continue;
    }

    const contents = await entry.async("nodebuffer");
    output.file(name, contents, {
      dir: false,
      compression: "DEFLATE",
      compressionOptions: { level: COMPRESSION_LEVEL },
      createFolders: false,
      date: FIXED_ZIP_DATE,
      dosPermissions: 0,
      unixPermissions: FILE_PERMISSIONS,
    });
  }

  const normalized = await output.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: COMPRESSION_LEVEL },
    comment: "",
    platform: "UNIX",
    type: "nodebuffer",
  });
  const temporaryPath = `${packagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "wx");
  try {
    fs.writeFileSync(descriptor, normalized);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporaryPath, packagePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "PBIVIZ atomic replacement failed.");
    }
    throw error;
  }
}

if (require.main === module) {
  normalizePackage(findPackagePath()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { FIXED_ZIP_DATE, findPackagePath, normalizePackage };
