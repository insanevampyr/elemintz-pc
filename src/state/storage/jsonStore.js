import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "../paths.js";

const BACKUP_RETENTION_LIMIT = 3;

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

async function createBackupIfPresent(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);
  const backupPath = path.join(directory, buildBackupFilename(filename));

  try {
    await fs.copyFile(filePath, backupPath);
    console.info("[JsonStore] backup created", {
      filePath,
      backupPath
    });
  } catch (error) {
    console.warn("[JsonStore] backup creation failed", {
      filePath,
      backupPath,
      message: error?.message
    });
    return;
  }

  try {
    const backupPrefix = `${filename}.backup-`;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const backups = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(backupPrefix) && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const staleBackups = backups.slice(0, Math.max(0, backups.length - BACKUP_RETENTION_LIMIT));

    await Promise.all(
      staleBackups.map((backupName) => fs.rm(path.join(directory, backupName), { force: true }))
    );

    console.info("[JsonStore] backup cleanup performed", {
      filePath,
      deletedBackups: staleBackups.length
    });
  } catch (error) {
    console.warn("[JsonStore] backup cleanup failed", {
      filePath,
      message: error?.message
    });
  }
}

async function ensureFile(filePath, fallbackValue) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
  }
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
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
    await ensureFile(this.filePath, fallbackValue);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const sanitized = stripBom(raw);
      return JSON.parse(sanitized);
    } catch {
      await this.write(fallbackValue);
      return fallbackValue;
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await createBackupIfPresent(this.filePath);
    await fs.writeFile(this.filePath, JSON.stringify(value, null, 2), "utf8");
    return value;
  }
}
