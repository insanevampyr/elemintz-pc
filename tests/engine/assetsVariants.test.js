import test from "node:test";
import assert from "node:assert/strict";

import { COSMETIC_CATALOG } from "../../src/state/cosmeticSystem.js";
import { getAssetPath } from "../../src/renderer/utils/dom.js";
import { getAvatarImage, getCardBackImage, getVariantCardImages } from "../../src/renderer/utils/assets.js";

test("assets: per-element variant selection affects only selected element", () => {
  const map = getVariantCardImages({
    fire: "arcane_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  });

  assert.match(map.fire, /arcaneFire\.jpg$/);
  assert.match(map.water, /cards\/water\.jpg$/);
  assert.match(map.earth, /cards\/earth\.jpg$/);
  assert.match(map.wind, /cards\/wind\.jpg$/);
});

test("assets: legacy bundle id still resolves for migration compatibility", () => {
  const map = getVariantCardImages("arcane_element_cards");

  assert.match(map.fire, /arcaneFire\.jpg$/);
  assert.match(map.water, /waterfall\.jpg$/);
  assert.match(map.earth, /rockShell\.jpg$/);
  assert.match(map.wind, /tornado\.jpg$/);
});

test("assets: newly added element variant ids resolve to the expected images", () => {
  const map = getVariantCardImages({
    fire: "arcane_blue_flame_card",
    water: "wave_water_card",
    earth: "rock_storm_card",
    wind: "smokey_wind_card"
  });

  assert.match(map.fire, /arcaneBlueFlame\.jpg$/);
  assert.match(map.water, /wave\.jpg$/);
  assert.match(map.earth, /rockStorm\.jpg$/);
  assert.match(map.wind, /smokeyWind\.jpg$/);
});

test("assets: default and founder card backs resolve to card_backs assets", () => {
  assert.match(getCardBackImage("default_card_back"), /card_backs\/default_back\.jpg$/);
  assert.match(
    getCardBackImage("founder_deluxe_card_back"),
    /card_backs\/founder_deluxe_card_back\.png$/
  );
  assert.match(
    getCardBackImage("supporter_card_back"),
    /card_backs\/founder_deluxe_card_back\.png$/
  );
});

test("assets: getAssetPath resolves assets from module location as a file URL", () => {
  const resolved = getAssetPath("titles/title_apprentice.png");

  assert.match(resolved, /^file:/);
  assert.match(resolved, /assets\/titles\/title_apprentice\.png$/);
});

test("assets: new avatar ids resolve through the avatar asset map", () => {
  const avatarIds = [
    "avatar_smirk_ember",
    "avatar_bubble_brat",
    "avatar_moss_mood",
    "avatar_neon_puff",
    "avatar_stone_cold_cutie",
    "avatar_storm_brat",
    "avatar_tidal_diva",
    "avatar_ashen_trickster",
    "avatar_corrupt_cherub",
    "avatar_void_glam",
    "avatar_riot_halo",
    "avatar_golden_menace",
    "avatar_chaos_monarch",
    "avatar_rose_riot"
  ];

  for (const avatarId of avatarIds) {
    const resolved = getAvatarImage(avatarId);
    assert.match(resolved, /^file:/);
    assert.match(resolved, new RegExp(`assets/avatars/${avatarId}\\.png$`.replace(/\//g, "\\/")));
  }
});

test("assets: new title catalog image paths resolve to the expected title assets", () => {
  const titleIds = [
    "title_chaos_gremlin",
    "title_soft_doom",
    "title_pretty_problem",
    "title_silent_menace",
    "title_drama_magnet",
    "title_neon_rebel",
    "title_velvet_villain",
    "title_void_doll",
    "title_glitch_royalty",
    "title_crownless_king",
    "title_divine_menace",
    "title_cataclysm_icon"
  ];
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));

  for (const titleId of titleIds) {
    const item = titles.get(titleId);
    assert.ok(item, `missing title ${titleId}`);
    const resolved = getAssetPath(item.image);
    assert.match(resolved, /^file:/);
    assert.match(resolved, new RegExp(`assets/titles/${titleId}\\.png$`.replace(/\//g, "\\/")));
  }
});
