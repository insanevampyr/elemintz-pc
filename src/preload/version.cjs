const fs = require("node:fs");
const path = require("node:path");

function resolveAppVersion({
  baseDir = __dirname,
  fsModule = fs,
  pathModule = path,
  fallback = "unknown"
} = {}) {
  const candidates = [
    pathModule.join(baseDir, "..", "..", "package.json"),
    pathModule.join(process.cwd(), "package.json")
  ];

  for (const candidate of candidates) {
    try {
      const raw = fsModule.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      const version = String(parsed?.version ?? "").trim();
      if (version) {
        return version;
      }
    } catch {
      // Keep the preload bridge alive even if version metadata is unavailable.
    }
  }

  return fallback;
}

module.exports = {
  resolveAppVersion
};
