import fs from "node:fs/promises";
import path from "node:path";

import { scanDailyElementChestMirrorParityProfiles } from "../src/state/eventChestProfileProgress.js";
import { resolveDataDir } from "../src/state/paths.js";

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function parseArgs(argv) {
  const options = {
    dataDir: null,
    detailLimit: 50
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      options.dataDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--data-dir=")) {
      options.dataDir = arg.slice("--data-dir=".length);
      continue;
    }
    if (arg === "--detail-limit") {
      options.detailLimit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--detail-limit=")) {
      options.detailLimit = Number(arg.slice("--detail-limit=".length));
    }
  }

  return {
    dataDir: options.dataDir,
    detailLimit: Number.isFinite(options.detailLimit)
      ? Math.max(0, Math.floor(options.detailLimit))
      : 50
  };
}

async function loadProfilesReadOnly(dataDir) {
  const profilesPath = path.join(resolveDataDir(dataDir), "profiles.json");

  try {
    const raw = await fs.readFile(profilesPath, "utf8");
    const parsed = JSON.parse(stripBom(raw));
    return {
      profilesPath,
      profiles: Array.isArray(parsed) ? parsed : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        profilesPath,
        profiles: []
      };
    }

    throw error;
  }
}

function formatStatusLabel(status) {
  return String(status ?? "")
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function printAudit(scan, { profilesPath }) {
  console.log("Daily Elemintz Chest Mirror Parity Audit");
  console.log(`Profiles file: ${profilesPath}`);
  console.log(`Total profiles: ${scan.totalProfiles}`);
  console.log(`Matched: ${scan.matched}`);
  console.log(`Missing mirror: ${scan.missing_mirror}`);
  console.log(`Mismatch: ${scan.mismatch}`);
  console.log(`Invalid chest id: ${scan.invalid_chest_id}`);

  if (!scan.details.length) {
    console.log("");
    console.log("Non-matched details: none");
    return;
  }

  console.log("");
  console.log("Non-matched details:");
  for (const detail of scan.details) {
    const fields = detail.mismatchFields?.length ? ` - ${detail.mismatchFields.join(", ")}` : "";
    console.log(`- ${detail.profileIdentifier}: ${formatStatusLabel(detail.status)}${fields}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { profilesPath, profiles } = await loadProfilesReadOnly(options.dataDir);
  const scan = scanDailyElementChestMirrorParityProfiles(profiles, {
    detailLimit: options.detailLimit
  });

  printAudit(scan, { profilesPath });
}

main().catch((error) => {
  console.error("Daily Elemintz Chest Mirror Parity Audit failed.");
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
