import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ProfileSystem,
  CURRENT_PROFILE_SCHEMA_VERSION,
  normalizeProfile
} from "../../src/state/profileSystem.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-profile-validation-"));
}

test("profile validation: repairs malformed fields and writes back the upgraded profile", async (t) => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "profiles.json");

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await fs.writeFile(
    filePath,
    JSON.stringify(
      [
        {
          username: "RepairUser",
          tokens: "450",
          wins: "7",
          losses: 3,
          playerXP: "not-a-number",
          achievements: [],
          chests: null,
          cosmeticLoadouts: {},
          onlineDisconnectTracking: "bad-data"
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const profiles = new ProfileSystem({ dataDir });
  const profile = await profiles.getProfile("RepairUser");
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(profile.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(profile.tokens, 450);
  assert.equal(profile.wins, 7);
  assert.equal(profile.losses, 3);
  assert.equal(profile.playerXP, 0);
  assert.equal(typeof profile.achievements, "object");
  assert.equal(Array.isArray(profile.achievements), false);
  assert.equal(typeof profile.chests, "object");
  assert.equal(Array.isArray(profile.cosmeticLoadouts), true);
  assert.equal(
    profile.onlineDisconnectTracking.totalLiveMatchDisconnects,
    0
  );
  assert.equal(persisted[0].schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(persisted[0].tokens, 450);
  assert.equal(Array.isArray(persisted[0].cosmeticLoadouts), true);
});

test("profile validation: repairs broken sections without wiping valid progression", async (t) => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "profiles.json");

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await fs.writeFile(
    filePath,
    JSON.stringify(
      [
        {
          username: "PreserveSectionsUser",
          schemaVersion: 1,
          wins: 12,
          tokens: 777,
          chests: null,
          achievements: [],
          equippedCosmetics: {
            avatar: "avatar_crystal_soul",
            background: "bg_verdant_shrine",
            cardBack: "cardback_arcane_galaxy",
            badge: "badge_element_initiate",
            title: "title_apprentice",
            elementCardVariant: null
          },
          ownedCosmetics: {
            avatar: ["default_avatar", "avatar_crystal_soul"],
            cardBack: ["default_card_back", "cardback_arcane_galaxy"],
            background: ["default_background", "bg_verdant_shrine"],
            elementCardVariant: ["fire_variant_crownfire"],
            badge: ["default_badge", "badge_element_initiate"],
            title: ["title_initiate", "title_apprentice"]
          },
          onlineDisconnectTracking: {
            totalLiveMatchDisconnects: "6",
            totalReconnectTimeoutExpirations: null,
            totalSuccessfulReconnectResumes: 2,
            recentDisconnectTimestamps: "wrong",
            recentExpirationTimestamps: ["2026-03-19T10:00:00.000Z"]
          }
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const profiles = new ProfileSystem({ dataDir });
  const profile = await profiles.getProfile("PreserveSectionsUser");

  assert.equal(profile.wins, 12);
  assert.equal(profile.tokens, 777);
  assert.equal(profile.equippedCosmetics.avatar, "avatar_crystal_soul");
  assert.equal(profile.equippedCosmetics.background, "bg_verdant_shrine");
  assert.equal(profile.equippedCosmetics.cardBack, "cardback_arcane_galaxy");
  assert.equal(Array.isArray(profile.ownedCosmetics.avatar), true);
  assert.equal(profile.ownedCosmetics.avatar.includes("avatar_crystal_soul"), true);
  assert.equal(typeof profile.chests, "object");
  assert.equal(typeof profile.achievements, "object");
  assert.equal(Array.isArray(profile.achievements), false);
  assert.equal(
    typeof profile.equippedCosmetics.elementCardVariant,
    "object"
  );
  assert.equal(
    profile.onlineDisconnectTracking.totalLiveMatchDisconnects,
    6
  );
  assert.equal(
    profile.onlineDisconnectTracking.totalReconnectTimeoutExpirations,
    0
  );
  assert.equal(
    Array.isArray(profile.onlineDisconnectTracking.recentDisconnectTimestamps),
    true
  );
  assert.equal(
    profile.onlineDisconnectTracking.recentExpirationTimestamps.length,
    1
  );
});

test("profile validation: already valid profiles are not destructively rewritten", async (t) => {
  const dataDir = await createTempDataDir();

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const profiles = new ProfileSystem({ dataDir });
  await profiles.ensureProfile("ValidProfileUser");

  const filePath = path.join(dataDir, "profiles.json");
  const before = await fs.readFile(filePath, "utf8");
  const loaded = await profiles.getProfile("ValidProfileUser");
  const after = await fs.readFile(filePath, "utf8");

  assert.equal(loaded.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(after, before);
});

test("profile validation: normalizeProfile is idempotent after the first repair", () => {
  const corruptedProfile = {
    username: "IdempotentRepairUser",
    tokens: "450",
    achievements: [],
    chests: null,
    cosmeticLoadouts: {},
    onlineDisconnectTracking: "bad-data"
  };

  const firstPass = normalizeProfile(corruptedProfile);
  const secondPass = normalizeProfile(firstPass);

  assert.deepEqual(secondPass, firstPass);
});

test("profile validation: valid profile stays stable and emits no repair logs", () => {
  const validProfile = normalizeProfile({
    username: "StableValidUser"
  });

  const infoLogs = [];
  const warnLogs = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;

  console.info = (...args) => infoLogs.push(args);
  console.warn = (...args) => warnLogs.push(args);

  try {
    const normalized = normalizeProfile(validProfile);
    assert.deepEqual(normalized, validProfile);
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.equal(
    infoLogs.some((entry) => entry[0] === "[ProfileSystem] validation repaired field"),
    false
  );
  assert.equal(
    infoLogs.some((entry) => entry[0] === "[ProfileSystem] validation repaired section"),
    false
  );
  assert.equal(
    infoLogs.some(
      (entry) => entry[0] === "[ProfileSystem] validation idempotent - no changes applied"
    ),
    true
  );
  assert.equal(
    warnLogs.some(
      (entry) => entry[0] === "[ProfileSystem] WARNING: normalization introduced unexpected mutation"
    ),
    false
  );
});

test("profile validation: corrupted profile repairs only on first normalize pass", () => {
  const corruptedProfile = {
    username: "RepairOnceUser",
    tokens: "450",
    achievements: [],
    onlineDisconnectTracking: "bad-data"
  };

  const infoLogs = [];
  const originalInfo = console.info;
  console.info = (...args) => infoLogs.push(args);

  let firstPass;
  let secondPass;

  try {
    firstPass = normalizeProfile(corruptedProfile);
    secondPass = normalizeProfile(firstPass);
  } finally {
    console.info = originalInfo;
  }

  assert.deepEqual(secondPass, firstPass);

  const repairedFieldLogs = infoLogs.filter(
    (entry) => entry[0] === "[ProfileSystem] validation repaired field"
  );
  const repairedSectionLogs = infoLogs.filter(
    (entry) => entry[0] === "[ProfileSystem] validation repaired section"
  );
  const idempotentLogs = infoLogs.filter(
    (entry) => entry[0] === "[ProfileSystem] validation idempotent - no changes applied"
  );

  assert.equal(repairedFieldLogs.length > 0 || repairedSectionLogs.length > 0, true);
  assert.equal(idempotentLogs.length >= 1, true);
});
