import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import JSZip from "jszip";

const FIXED_DATE = new Date("1980-01-01T00:00:00.000Z");
const FILE_PERMISSIONS = 0o100644;
const DIRECTORY_PERMISSIONS = 0o40755;

export async function normalizePbiviz(filePath) {
  const source = await open(filePath, "r");
  let input;
  try {
    input = await source.readFile();
  } finally {
    await source.close();
  }

  const sourceZip = await JSZip.loadAsync(input);
  const normalizedZip = new JSZip();
  for (const name of Object.keys(sourceZip.files).sort()) {
    const entry = sourceZip.files[name];
    const data = entry.dir ? Buffer.alloc(0) : await entry.async("nodebuffer");
    normalizedZip.file(name, data, {
      date: FIXED_DATE,
      dir: entry.dir,
      dosPermissions: 0,
      createFolders: false,
      unixPermissions: entry.dir ? DIRECTORY_PERMISSIONS : FILE_PERMISSIONS,
    });
  }

  const output = await normalizedZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
    comment: "",
  });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const temporary = await open(temporaryPath, "wx");
  try {
    await temporary.writeFile(output);
    await temporary.sync();
  } finally {
    await temporary.close();
  }

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "PBIVIZ atomic replacement failed.");
    }
    throw error;
  }
}
