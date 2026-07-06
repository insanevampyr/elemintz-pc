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

test("profile validation: ensureProfile repairs only the requested stored profile while listProfiles remains the full sweep", async (t) => {
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
          username: "TargetUser",
          tokens: "450",
          achievements: [],
          chests: null
        },
        {
          username: "OtherUser",
          tokens: "275",
          achievements: [],
          chests: null
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const profiles = new ProfileSystem({ dataDir });
  const target = await profiles.ensureProfile("TargetUser");
  const afterEnsure = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(target.tokens, 450);
  assert.equal(afterEnsure[0].schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(typeof afterEnsure[0].achievements, "object");
  assert.equal(Array.isArray(afterEnsure[0].achievements), false);
  assert.equal(afterEnsure[1].schemaVersion, undefined);
  assert.equal(Array.isArray(afterEnsure[1].achievements), true);
  assert.equal(afterEnsure[1].chests, null);

  await profiles.listProfiles();
  const afterList = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(afterList[1].schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(typeof afterList[1].achievements, "object");
  assert.equal(Array.isArray(afterList[1].achievements), false);
  assert.equal(typeof afterList[1].chests, "object");
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
    infoLogs.some((entry) => entry[0] === "[ProfileSystem] validation complete"),
    false
  );
  assert.equal(
    infoLogs.some(
      (entry) => entry[0] === "[ProfileSystem] validation idempotent - no changes applied"
    ),
    false
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

  const repairedSummaries = infoLogs.filter(
    (entry) => entry[0] === "[ProfileSystem] validation complete" && entry[1]?.repairedCount > 0
  );
  const idempotentLogs = infoLogs.filter(
    (entry) => entry[0] === "[ProfileSystem] validation idempotent - no changes applied"
  );

  assert.equal(repairedSummaries.length >= 1, true);
  assert.equal(idempotentLogs.length, 0);
});

test("profile validation: Battle Report normalization repairs once and remains stable", async (t) => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "profiles.json");

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const pveBattle = {
    mode: "pve",
    result: "win",
    opponentName: "Elemental AI",
    completedAt: "2026-06-27T12:01:00.000Z",
    rounds: null,
    warsEntered: null
  };
  const localBattle = {
    mode: "localHotseat",
    result: "draw",
    opponentName: "Player Two",
    completedAt: "2026-06-27T12:02:00.000Z",
    rounds: 4,
    warsEntered: 0
  };
  const gauntletBattle = {
    mode: "gauntlet",
    result: "loss",
    rivalName: "Countess Veyra",
    completedAt: "2026-06-27T12:03:00.000Z",
    rounds: 5,
    warsEntered: 1
  };
  const featuredBattle = {
    mode: "featuredRival",
    result: "win",
    rivalName: "Crownfire Duelist",
    completedAt: "2026-06-27T12:04:00.000Z",
    rounds: 6,
    warsEntered: 2
  };
  const onlineBattle = {
    mode: "online",
    result: "win",
    opponentName: "RemoteUser",
    opponentUsername: "RemoteUser",
    opponentUserId: null,
    completedAt: "2026-06-27T12:05:00.000Z",
    rounds: 7,
    warsEntered: 3
  };
  const bloodBattle = {
    mode: "bloodMatch",
    displayMode: "Blood Match",
    result: "loss",
    completedAt: "2026-06-27T12:06:00.000Z",
    rounds: 8,
    warsEntered: 4,
    rivalName: "Countess Veyra & Ravena Moonfang",
    endReason: null,
    playerCardsCaptured: 5,
    playerHandAtEnd: 0,
    vampireHandAtEnd: 3,
    lycanHandAtEnd: 2,
    twoWayWars: null,
    threeWayWars: 1
  };
  const legacyProfile = {
    ...normalizeProfile({ username: "BattleReportRepairUser" }),
    latestBattle: pveBattle,
    recentBattles: [
      pveBattle,
      gauntletBattle,
      localBattle,
      bloodBattle,
      onlineBattle,
      featuredBattle,
      onlineBattle
    ]
  };

  await fs.writeFile(filePath, JSON.stringify([legacyProfile], null, 2), "utf8");

  const profiles = new ProfileSystem({ dataDir });
  const firstInfoLogs = [];
  const firstWarnLogs = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args) => firstInfoLogs.push(args);
  console.warn = (...args) => firstWarnLogs.push(args);

  let repaired;
  try {
    repaired = await profiles.getProfile("BattleReportRepairUser");
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.equal(
    firstWarnLogs.some(
      (entry) => entry[0] === "[ProfileSystem] WARNING: normalization introduced unexpected mutation"
    ),
    false
  );
  assert.equal(
    firstInfoLogs.some(
      (entry) =>
        entry[0] === "[ProfileSystem] validation complete" &&
        entry[1]?.repairedFields?.includes("latestBattle") &&
        entry[1]?.repairedFields?.includes("recentBattles")
    ),
    true
  );
  assert.equal(repaired.recentBattles.length, 5);
  assert.deepEqual(
    repaired.recentBattles.map((entry) => entry.completedAt),
    [
      "2026-06-27T12:06:00.000Z",
      "2026-06-27T12:05:00.000Z",
      "2026-06-27T12:04:00.000Z",
      "2026-06-27T12:03:00.000Z",
      "2026-06-27T12:02:00.000Z"
    ]
  );
  assert.deepEqual(repaired.latestBattle, repaired.recentBattles[0]);
  assert.equal(repaired.recentBattles.filter((entry) => entry.mode === "online").length, 1);
  assert.equal(repaired.recentBattles[0].mode, "bloodMatch");
  assert.equal(repaired.recentBattles[0].twoWayWars, null);
  assert.equal(repaired.recentBattles[0].threeWayWars, 1);
  assert.equal(repaired.recentBattles.some((entry) => entry.mode === "featuredRival"), true);
  assert.equal(repaired.recentBattles.some((entry) => entry.mode === "gauntlet"), true);
  assert.equal(repaired.recentBattles.some((entry) => entry.mode === "localHotseat"), true);
  assert.equal(repaired.recentBattles.some((entry) => entry.mode === "online"), true);
  assert.equal(repaired.recentBattles.some((entry) => entry.mode === "pve"), false);

  const savedAfterRepair = JSON.parse(await fs.readFile(filePath, "utf8"))[0];
  assert.deepEqual(savedAfterRepair.latestBattle, repaired.latestBattle);
  assert.deepEqual(savedAfterRepair.recentBattles, repaired.recentBattles);

  const secondInfoLogs = [];
  const secondWarnLogs = [];
  console.info = (...args) => secondInfoLogs.push(args);
  console.warn = (...args) => secondWarnLogs.push(args);

  let reloaded;
  try {
    reloaded = await profiles.getProfile("BattleReportRepairUser");
    await profiles.updateProfile("BattleReportRepairUser", (profile) => profile);
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.deepEqual(reloaded, repaired);
  assert.equal(
    secondInfoLogs.some(
      (entry) =>
        entry[0] === "[ProfileSystem] validation complete" &&
        entry[1]?.repairedFields?.some((field) => field === "latestBattle" || field === "recentBattles")
    ),
    false
  );
  assert.equal(
    secondWarnLogs.some(
      (entry) => entry[0] === "[ProfileSystem] WARNING: normalization introduced unexpected mutation"
    ),
    false
  );
});

test("profile validation: seenAnnouncements repairs malformed values to an object", () => {
  const normalized = normalizeProfile({
    username: "AnnouncementRepairUser",
    seenAnnouncements: "bad-data"
  });

  assert.deepEqual(normalized.seenAnnouncements, {});
});

test("profile validation: seenAnnouncements preserves valid announcement flags", () => {
  const normalized = normalizeProfile({
    username: "AnnouncementSeenUser",
    seenAnnouncements: {
      "cosmetics_v0.1.6": true,
      future_release: false
    }
  });

  assert.deepEqual(normalized.seenAnnouncements, {
    "cosmetics_v0.1.6": true,
    future_release: false
  });
});
