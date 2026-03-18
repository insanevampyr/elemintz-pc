import test from "node:test";
import assert from "node:assert/strict";

import { getAssetPath } from "../../src/renderer/utils/dom.js";
import { getCardBackImage, getVariantCardImages } from "../../src/renderer/utils/assets.js";

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
