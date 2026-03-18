import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "../paths.js";

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
    await fs.writeFile(this.filePath, JSON.stringify(value, null, 2), "utf8");
    return value;
  }
}
