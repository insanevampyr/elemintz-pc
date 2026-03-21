import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileSystem, CURRENT_PROFILE_SCHEMA_VERSION } from "../../src/state/profileSystem.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-profile-migration-"));
}

test("profile migration: missing schemaVersion is upgraded and written back", async (t) => {
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
          username: "LegacyUser",
          wins: 7,
          losses: 2,
          tokens: 450
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const profiles = new ProfileSystem({ dataDir });
  const profile = await profiles.getProfile("LegacyUser");
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(profile.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(profile.wins, 7);
  assert.equal(profile.losses, 2);
  assert.equal(profile.tokens, 450);
  assert.equal(persisted[0].schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
});

test("profile migration: older schema preserves progression-heavy fields while upgrading", async (t) => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "profiles.json");

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const legacyProfile = {
    username: "PreserveUser",
    schemaVersion: 0,
    wins: 11,
    losses: 4,
    gamesPlayed: 15,
    warsEntered: 9,
    warsWon: 5,
    longestWar: 3,
    cardsCaptured: 42,
    playerXP: 88,
    playerLevel: 3,
    achievements: {
      comeback_win: 1
    },
    modeStats: {
      pve: { wins: 3, losses: 1, gamesPlayed: 4 },
      local_pvp: { wins: 2, losses: 1, gamesPlayed: 3 },
      online_pvp: { wins: 1, losses: 2, gamesPlayed: 3 }
    },
    equippedCosmetics: {
      avatar: "avatar_crystal_soul",
      background: "bg_verdant_shrine",
      cardBack: "cardback_arcane_galaxy",
      badge: "badge_element_initiate",
      title: "title_apprentice",
      elementCardVariant: {
        fire: "fire_variant_crownfire",
        water: "water_variant_tidal_spirit",
        earth: "earth_variant_transparent_crystal",
        wind: "wind_variant_vortex_spirit"
      }
    },
    cosmeticLoadouts: [
      {
        name: "Main",
        cosmetics: {
          avatar: "avatar_crystal_soul",
          background: "bg_verdant_shrine",
          cardBack: "cardback_arcane_galaxy",
          badge: "badge_element_initiate",
          title: "title_apprentice",
          elementCardVariant: {
            fire: "fire_variant_crownfire",
            water: "water_variant_tidal_spirit",
            earth: "earth_variant_transparent_crystal",
            wind: "wind_variant_vortex_spirit"
          }
        }
      }
    ],
    chests: {
      basic: 2
    },
    dailyChallenges: {
      dateKey: "2026-03-20",
      weeklyDateKey: "2026-W12"
    },
    onlineDisconnectTracking: {
      totalLiveMatchDisconnects: 2,
      totalReconnectTimeoutExpirations: 1,
      totalSuccessfulReconnectResumes: 3,
      recentDisconnectTimestamps: ["2026-03-18T10:00:00.000Z"],
      recentExpirationTimestamps: ["2026-03-19T10:00:00.000Z"]
    }
  };

  await fs.writeFile(filePath, JSON.stringify([legacyProfile], null, 2), "utf8");

  const profiles = new ProfileSystem({ dataDir });
  const profile = await profiles.getProfile("PreserveUser");

  assert.equal(profile.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(profile.wins, 11);
  assert.equal(profile.playerXP, 88);
  assert.equal(profile.equippedCosmetics.avatar, "avatar_crystal_soul");
  assert.equal(profile.equippedCosmetics.background, "bg_verdant_shrine");
  assert.equal(profile.chests.basic, 2);
  assert.equal(profile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 3);
  assert.equal(profile.achievements.comeback_win.count, 1);
  assert.equal(profile.cosmeticLoadouts[0].name, "Main");
});

test("profile migration: already-current profiles are not destructively rewritten", async (t) => {
  const dataDir = await createTempDataDir();

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const profiles = new ProfileSystem({ dataDir });
  await profiles.ensureProfile("CurrentUser");

  const before = await fs.readFile(path.join(dataDir, "profiles.json"), "utf8");
  const loaded = await profiles.getProfile("CurrentUser");
  const after = await fs.readFile(path.join(dataDir, "profiles.json"), "utf8");

  assert.equal(loaded.schemaVersion, CURRENT_PROFILE_SCHEMA_VERSION);
  assert.equal(after, before);
});
