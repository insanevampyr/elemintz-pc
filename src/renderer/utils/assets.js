import { getAssetPath } from "./dom.js";

const CARD_BACKS = Object.freeze({
  default_card_back: getAssetPath("card_backs/default_back.jpg"),
  supporter_card_back: getAssetPath("card_backs/founder_deluxe_card_back.png"),
  founder_deluxe_card_back: getAssetPath("card_backs/founder_deluxe_card_back.png"),
  ember_card_back: getAssetPath("card_backs/ember_card_back.png"),
  crystal_card_back: getAssetPath("card_backs/crystal_card_back.png"),
  stone_rune_card_back: getAssetPath("card_backs/stone_rune_card_back.png"),
  storm_sigil_card_back: getAssetPath("card_backs/storm_sigil_card_back.png"),
  void_card_back: getAssetPath("card_backs/void_card_back.png"),
  royal_gold_card_back: getAssetPath("card_backs/royal_gold_card_back.png"),
  arcane_library_card_back: getAssetPath("card_backs/arcane_library_card_back.png"),
  cardback_arcane_galaxy: getAssetPath("card_backs/cardback_arcane_galaxy.png"),
  cardback_elemental_nexus: getAssetPath("card_backs/cardback_elemental_nexus.png"),
  cardback_founder_ember: getAssetPath("card_backs/cardback_founder_ember.png"),
  cardback_frozen_sigil: getAssetPath("card_backs/cardback_frozen_sigil.png"),
  cardback_lava_core: getAssetPath("card_backs/cardback_lava_core.png"),
  cardback_obsidian_halo: getAssetPath("card_backs/cardback_obsidian_halo.png"),
  cardback_storm_spiral: getAssetPath("card_backs/cardback_storm_spiral.png"),
  cardback_verdant_relic: getAssetPath("card_backs/cardback_verdant_relic.png"),
  i_dont_lose_transparent_cardback: getAssetPath("card_backs/i_dont_lose_transparent_cardback.png"),
  i_dont_lose_cardback: getAssetPath("card_backs/i_dont_lose_cardback.png"),
  elemental_chest_cardback: getAssetPath("card_backs/elemental_chest_cardback.png"),
  wont_take_long_cardback: getAssetPath("card_backs/wont_take_long_cardback.png"),
  outplayed_too_easy_cardback: getAssetPath("card_backs/outplayed_too_easy_cardback.png"),
  cry_about_it_cardback: getAssetPath("card_backs/cry_about_it_cardback.png"),
  dreamscape_cardback: getAssetPath("card_backs/dreamscape_cardback.png"),
  charmed_heart_cardback: getAssetPath("card_backs/charmed_heart_cardback.png"),
  gothic_heart_cardback: getAssetPath("card_backs/gothic_heart_cardback.png"),
  mystic_bloom_cardback: getAssetPath("card_backs/mystic_bloom_cardback.png"),
  your_gonna_lose_2: getAssetPath("card_backs/your_gonna_lose_2.png"),
  your_gonna_lose: getAssetPath("card_backs/your_gonna_lose.png")
});

const DEFAULT_ELEMENT_IMAGES = Object.freeze({
  fire: getAssetPath("cards/fire.jpg"),
  water: getAssetPath("cards/water.jpg"),
  earth: getAssetPath("cards/earth.jpg"),
  wind: getAssetPath("cards/wind.jpg")
});

const ELEMENT_VARIANT_IMAGES = Object.freeze({
  default_fire_card: Object.freeze({ element: "fire", image: DEFAULT_ELEMENT_IMAGES.fire }),
  default_water_card: Object.freeze({ element: "water", image: DEFAULT_ELEMENT_IMAGES.water }),
  default_earth_card: Object.freeze({ element: "earth", image: DEFAULT_ELEMENT_IMAGES.earth }),
  default_wind_card: Object.freeze({ element: "wind", image: DEFAULT_ELEMENT_IMAGES.wind }),
  arcane_fire_card: Object.freeze({ element: "fire", image: getAssetPath("cards/arcaneFire.jpg") }),
  arcane_blue_flame_card: Object.freeze({ element: "fire", image: getAssetPath("arcaneBlueFlame.jpg") }),
  blue_fire_card: Object.freeze({ element: "fire", image: getAssetPath("cards/blueFire.jpg") }),
  classic_flame_card: Object.freeze({ element: "fire", image: getAssetPath("cards/classicFlame.jpg") }),
  arcane_water_card: Object.freeze({ element: "water", image: getAssetPath("cards/waterfall.jpg") }),
  water_pool_card: Object.freeze({ element: "water", image: getAssetPath("cards/waterPool.jpg") }),
  wave_water_card: Object.freeze({ element: "water", image: getAssetPath("cards/wave.jpg") }),
  arcane_earth_card: Object.freeze({ element: "earth", image: getAssetPath("cards/rockShell.jpg") }),
  bold_earth_card: Object.freeze({ element: "earth", image: getAssetPath("cards/boldEarth.jpg") }),
  rock_storm_card: Object.freeze({ element: "earth", image: getAssetPath("cards/rockStorm.jpg") }),
  arcane_wind_card: Object.freeze({ element: "wind", image: getAssetPath("cards/tornado.jpg") }),
  smoke_wind_card: Object.freeze({ element: "wind", image: getAssetPath("cards/smoke.jpg") }),
  smokey_wind_card: Object.freeze({ element: "wind", image: getAssetPath("cards/smokeyWind.jpg") }),
  fire_variant_ember: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_ember.png") }),
  fire_variant_blue_inferno: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_blue_inferno.png") }),
  fire_variant_crownfire: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_crownfire.png") }),
  fire_variant_ember_core: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_ember_core.png") }),
  fire_variant_phoenix: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_phoenix.png") }),
  fire_variant_transparent_flame: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_transparent_flame.png") }),
  water_variant_crystal: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_crystal.png") }),
  water_variant_abyss_wave: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_abyss_wave.png") }),
  water_variant_crystal_iceburst: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_crystal_iceburst.png") }),
  water_variant_tidal_spirit: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_tidal_spirit.png") }),
  water_variant_transparent_wave: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_transparent_wave.png") }),
  water_variant_water_pillar: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_water_pillar.png") }),
  earth_variant_titan: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_titan.png") }),
  earth_variant_crystal_titan: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_crystal_titan.png") }),
  earth_variant_mountain_heart: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_mountain_heart.png") }),
  earth_variant_rooted_monolith: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_rooted_monolith.png") }),
  earth_variant_stone_colossus: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_stone_colossus.png") }),
  earth_variant_transparent_crystal: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_transparent_crystal.png") }),
  wind_variant_sky_serpent: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_sky_serpent.png") }),
  wind_variant_storm_eye: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_storm_eye.png") }),
  wind_variant_transparent_vortex: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_transparent_vortex.png") }),
  wind_variant_vortex_spirit: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_vortex_spirit.png") }),
  wind_variant_whisper_spiral: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_whisper_spiral.png") })
});

const LEGACY_VARIANT_BUNDLES = Object.freeze({
  default_element_cards: {
    fire: "default_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  },
  arcane_element_cards: {
    fire: "arcane_fire_card",
    water: "arcane_water_card",
    earth: "arcane_earth_card",
    wind: "arcane_wind_card"
  }
});

const AVATAR_MAP = Object.freeze({
  default_avatar: getAssetPath("avatars/default.png"),
  fireavatarF: getAssetPath("avatars/fireavatarF.png"),
  fireavatarM: getAssetPath("avatars/fireavatarM.png"),
  wateravatarF: getAssetPath("avatars/wateravatarF.png"),
  wateravatarM: getAssetPath("avatars/wateravatarM.png"),
  earthavatarF: getAssetPath("avatars/earthavatarF.png"),
  earthavatarM: getAssetPath("avatars/earthavatarM.png"),
  windavatarF: getAssetPath("avatars/windavatarF.png"),
  windavatarM: getAssetPath("avatars/windavatarM.png"),
  fire_avatar_f: getAssetPath("avatars/fire_avatar_f.png"),
  fire_avatar_m: getAssetPath("avatars/fire_avatar_m.png"),
  water_avatar_f: getAssetPath("avatars/water_avatar_f.png"),
  water_avatar_m: getAssetPath("avatars/water_avatar_m.png"),
  earth_avatar_f: getAssetPath("avatars/earth_avatar_f.png"),
  earth_avatar_m: getAssetPath("avatars/earth_avatar_m.png"),
  wind_avatar_f: getAssetPath("avatars/wind_avatar_f.png"),
  wind_avatar_m: getAssetPath("avatars/wind_avatar_m.png"),
  avatar_flame_spirit_f: getAssetPath("avatars/avatar_flame_spirit_f.png"),
  avatar_flame_spirit_m: getAssetPath("avatars/avatar_flame_spirit_m.png"),
  avatar_tidal_warden_f: getAssetPath("avatars/avatar_tidal_warden_f.png"),
  avatar_tidal_warden_m: getAssetPath("avatars/avatar_tidal_warden_m.png"),
  avatar_wind_whisperer_f: getAssetPath("avatars/avatar_wind_whisperer_f.png"),
  avatar_wind_whisperer_m: getAssetPath("avatars/avatar_wind_whisperer_m.png"),
  avatar_earth_titan_f: getAssetPath("avatars/avatar_earth_titan_f.png"),
  avatar_earth_titan_m: getAssetPath("avatars/avatar_earth_titan_m.png"),
  avatar_inferno_crown_f: getAssetPath("avatars/avatar_inferno_crown_f.png"),
  avatar_inferno_crown_m: getAssetPath("avatars/avatar_inferno_crown_m.png"),
  avatar_crystal_soul: getAssetPath("avatars/avatar_crystal_soul.png"),
  avatar_stone_guardian: getAssetPath("avatars/avatar_stone_guardian.png"),
  avatar_storm_oracle: getAssetPath("avatars/avatar_storm_oracle.png"),
  avatar_abyss_watcher: getAssetPath("avatars/avatar_abyss_watcher.png"),
  avatar_fourfold_lord: getAssetPath("avatars/avatar_fourfold_lord.png"),
  avatar_novice_mage: getAssetPath("avatars/avatar_novice_mage.png"),
  avatar_battle_adept: getAssetPath("avatars/avatar_battle_adept.png"),
  avatar_veteran_champion: getAssetPath("avatars/avatar_veteran_champion.png"),
  avatar_grand_archmage: getAssetPath("avatars/avatar_grand_archmage.png")
});

const BADGE_IMAGES = Object.freeze({
  none: null,
  war_machine_badge: getAssetPath("badges/warMachine.png"),
  supporter_badge: getAssetPath("badges/earlyAlphaTester.png"),
  badge_element_initiate: getAssetPath("badges/badge_element_initiate.png"),
  badge_arena_challenger: getAssetPath("badges/badge_arena_challenger.png"),
  badge_element_veteran: getAssetPath("badges/badge_element_veteran.png"),
  badge_arena_legend: getAssetPath("badges/badge_arena_legend.png")
});

function buildVariantMap(selection = null) {
  const map = { ...DEFAULT_ELEMENT_IMAGES };

  if (!selection) {
    return map;
  }

  if (typeof selection === "string") {
    if (LEGACY_VARIANT_BUNDLES[selection]) {
      return buildVariantMap(LEGACY_VARIANT_BUNDLES[selection]);
    }

    const single = ELEMENT_VARIANT_IMAGES[selection];
    if (single) {
      map[single.element] = single.image;
    }

    return map;
  }

  if (typeof selection === "object") {
    for (const [element, variantId] of Object.entries(selection)) {
      const variant = ELEMENT_VARIANT_IMAGES[variantId];
      if (variant && variant.element === element) {
        map[element] = variant.image;
      }
    }
  }

  return map;
}

export const ASSET_CATALOG = Object.freeze({
  cards: Object.freeze({
    ...DEFAULT_ELEMENT_IMAGES,
    back: CARD_BACKS.default_card_back
  }),
  cardBacks: CARD_BACKS,
  backgrounds: Object.freeze({
    fireArena: getAssetPath("backgrounds/fireBattleArena.png"),
    waterArena: getAssetPath("backgrounds/waterBattleArena.png"),
    earthArena: getAssetPath("backgrounds/earthBattleArena.png"),
    windArena: getAssetPath("backgrounds/windBattleArena.png"),
    voidArena: getAssetPath("backgrounds/celestialVoidBattleArena.png"),
    default_background: getAssetPath("EleMintzIcon.png"),
    fire_background: getAssetPath("backgrounds/fireBattleArena.png"),
    water_background: getAssetPath("backgrounds/waterBattleArena.png"),
    earth_background: getAssetPath("backgrounds/earthBattleArena.png"),
    wind_background: getAssetPath("backgrounds/windBattleArena.png"),
    celestial_void_background: getAssetPath("backgrounds/celestialVoidBattleArena.png"),
    lava_throne_background: getAssetPath("backgrounds/lava_throne_background.png"),
    frozen_temple_background: getAssetPath("backgrounds/frozen_temple_background.png"),
    ruin_arena_background: getAssetPath("backgrounds/ruin_arena_background.png"),
    celestial_chamber_background: getAssetPath("backgrounds/celestial_chamber_background.png"),
    storm_peak_background: getAssetPath("backgrounds/storm_peak_background.png"),
    void_altar_background: getAssetPath("backgrounds/void_altar_background.png"),
    bg_ember_arena: getAssetPath("backgrounds/bg_ember_arena.png"),
    bg_sunken_court: getAssetPath("backgrounds/bg_sunken_court.png"),
    bg_verdant_shrine: getAssetPath("backgrounds/bg_verdant_shrine.png"),
    bg_storm_temple: getAssetPath("backgrounds/bg_storm_temple.png"),
    bg_crystal_cavern: getAssetPath("backgrounds/bg_crystal_cavern.png"),
    bg_moonlit_basin: getAssetPath("backgrounds/bg_moonlit_basin.png"),
    bg_elemental_throne: getAssetPath("backgrounds/bg_elemental_throne.png"),
    bg_eclipse_hall: getAssetPath("backgrounds/bg_eclipse_hall.png"),
    background_ancient_arena: getAssetPath("backgrounds/background_ancient_arena.png"),
    background_storm_citadel: getAssetPath("backgrounds/background_storm_citadel.png"),
    background_sky_temple: getAssetPath("backgrounds/background_sky_temple.png")
  }),
  avatars: AVATAR_MAP,
  sounds: Object.freeze({
    cardFlip: getAssetPath("sounds/card_flip.mp3"),
    playFire: getAssetPath("sounds/play_fire.mp3"),
    playWater: getAssetPath("sounds/play_water.mp3"),
    playEarth: getAssetPath("sounds/play_earth.mp3"),
    playWind: getAssetPath("sounds/play_wind.mp3"),
    warStart: getAssetPath("sounds/war_starts.mp3"),
    roundWin: getAssetPath("sounds/win_round.mp3"),
    roundLoss: getAssetPath("sounds/lose_round.mp3"),
    warLoss: getAssetPath("sounds/lose_war.mp3"),
    matchWin: getAssetPath("sounds/win_game.mp3"),
    matchLoss: getAssetPath("sounds/lose_game.mp3")
  })
});

export function getVariantCardImages(selection = null) {
  return buildVariantMap(selection);
}

export function getCardBackImage(cardBackId = "default_card_back") {
  return CARD_BACKS[cardBackId] ?? CARD_BACKS.default_card_back;
}

export function getCardImage(element, variantMap = null) {
  const map = variantMap ?? DEFAULT_ELEMENT_IMAGES;
  return map[element] ?? CARD_BACKS.default_card_back;
}

export function getArenaBackground(theme = "default_background") {
  if (!theme) {
    return ASSET_CATALOG.backgrounds.default_background;
  }

  if (ASSET_CATALOG.backgrounds[theme]) {
    return ASSET_CATALOG.backgrounds[theme];
  }

  const value = String(theme);
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("assets/") ||
    value.startsWith("../") ||
    value.startsWith("./")
  ) {
    return value;
  }

  if (value.includes("/") || value.endsWith(".png") || value.endsWith(".jpg") || value.endsWith(".jpeg")) {
    return getAssetPath(value);
  }

  return ASSET_CATALOG.backgrounds.default_background;
}

export function getAvatarImage(avatarId = "default_avatar") {
  return AVATAR_MAP[avatarId] ?? AVATAR_MAP.default_avatar;
}

export function getBadgeImage(badgeId = "none") {
  return BADGE_IMAGES[badgeId] ?? null;
}


