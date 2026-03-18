import os from "node:os";
import path from "node:path";

function defaultUserDataDir() {
  // Fallback for non-Electron contexts (tests/node scripts).
  return path.join(os.homedir(), "AppData", "Roaming", "EleMintz", "data");
}

export function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) {
    return explicitDataDir;
  }

  return defaultUserDataDir();
}
