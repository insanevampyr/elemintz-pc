import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "../paths.js";

// Keep a small rolling window of backups so recovery stays practical without
// letting persistence files grow unbounded over time.
const BACKUP_RETENTION_LIMIT = 5;

function formatBackupTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildBackupFilename(filename, timestamp = formatBackupTimestamp()) {
  return `${filename}.backup-${timestamp}.json`;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

// Centralize JSON serialization so we can reject undefined writes before they
// ever touch disk. This prevents accidental destructive writes from malformed
// caller input.
function serializeJson(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("[JsonStore] refusing to write undefined payload");
  }
  return serialized;
}

// Read and parse a JSON file in one place so normal loads and backup recovery
// share the exact same validation behavior.
async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(stripBom(raw));
}

async function listBackups(filePath) {
  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);
  const backupPrefix = `${filename}.backup-`;
  const entries = await fs.readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(backupPrefix) && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort()
    .reverse();
}

// Backups are created from the last known-good main file before each new write.
// If the main file does not exist yet, we simply skip backup creation.
async function createBackupIfPresent(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);
  const timestamp = formatBackupTimestamp();
  let backupPath = path.join(directory, buildBackupFilename(filename, timestamp));
  let collisionIndex = 1;

  // Writes can legitimately happen multiple times in the same second, so we
  // keep the requested timestamp format as the base name and append a numeric
  // suffix only when we would otherwise overwrite an earlier backup.
  while (await pathExists(backupPath)) {
    backupPath = path.join(directory, `${filename}.backup-${timestamp}-${String(collisionIndex).padStart(2, "0")}.json`);
    collisionIndex += 1;
  }

  await fs.copyFile(filePath, backupPath);
  console.info("[JsonStore] backup created", {
    filePath,
    backupPath
  });

  return backupPath;
}

// After creating a fresh backup, trim the backup set back down to the retention
// window so recovery stays predictable and disk usage remains bounded.
async function cleanupBackups(filePath) {
  const backups = await listBackups(filePath);
  const staleBackups = backups.slice(BACKUP_RETENTION_LIMIT);

  await Promise.all(staleBackups.map((backupPath) => fs.rm(backupPath, { force: true })));
}

// Write through a temporary file first, fsync it, then rename it into place so
// readers never observe a partially-written JSON file.
async function atomicReplaceFile(filePath, serializedValue) {
  const tempPath = `${filePath}.tmp`;
  let tempHandle = null;

  try {
    tempHandle = await fs.open(tempPath, "w");
    await tempHandle.writeFile(serializedValue, "utf8");
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Best-effort temp cleanup keeps failed writes from leaving misleading
    // partial artifacts next to the real persistence file.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await tempHandle?.close();
  }
}

// Initial file creation also goes through the same atomic temp-write path so
// first-run setup is protected by the same crash-safety guarantees as updates.
async function ensureFile(filePath, fallbackValue) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await atomicReplaceFile(filePath, serializeJson(fallbackValue));
  }
}

export class JsonStore {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.dataDir = resolveDataDir(options.dataDir);
  }

  get filePath() {
    return path.join(this.dataDir, this.filename);
  }

  async read(fallbackValue) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      // Missing data files are treated as first-run state, so we create the
      // requested fallback safely instead of treating that as corruption.
      await ensureFile(this.filePath, fallbackValue);
      return fallbackValue;
    }

    try {
      return await readJsonFile(this.filePath);
    } catch (error) {
      console.error("[JsonStore] recovery triggered", {
        filePath: this.filePath,
        message: error?.message
      });

      const backups = await listBackups(this.filePath).catch(() => []);
      for (const backupPath of backups) {
        try {
          const recoveredValue = await readJsonFile(backupPath);
          await atomicReplaceFile(this.filePath, serializeJson(recoveredValue));
          console.info("[JsonStore] recovery success", {
            filePath: this.filePath,
            backupPath
          });
          return recoveredValue;
        } catch (backupError) {
          console.warn("[JsonStore] backup recovery candidate failed", {
            filePath: this.filePath,
            backupPath,
            message: backupError?.message
          });
        }
      }

      await atomicReplaceFile(this.filePath, serializeJson(fallbackValue));
      console.error("[JsonStore] recovery failed - new file created", {
        filePath: this.filePath
      });
      return fallbackValue;
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    // Log before any disk mutation so crash reports show intent even if the
    // actual write fails before completion.
    console.info("[JsonStore] write start", {
      filePath: this.filePath
    });

    const serializedValue = serializeJson(value);

    // Create a recovery point from the current main file before replacing it.
    await createBackupIfPresent(this.filePath);

    // Prune backup history after taking the newest snapshot so we always retain
    // the most recent recovery points.
    await cleanupBackups(this.filePath);

    // Replace the main file only after the temp write has fully flushed.
    await atomicReplaceFile(this.filePath, serializedValue);

    console.info("[JsonStore] write success", {
      filePath: this.filePath
    });

    return value;
  }
}
