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
  cardback_neon_arcana: getAssetPath("card_backs/cardback_neon_arcana.png"),
  cardback_goldbound_relic: getAssetPath("card_backs/cardback_goldbound_relic.png"),
  cardback_glacier_sigil: getAssetPath("card_backs/cardback_glacier_sigil.png"),
  cardback_blood_gem: getAssetPath("card_backs/cardback_blood_gem.png"),
  cardback_winged_coffin: getAssetPath("card_backs/cardback_winged_coffin.png"),
  cardback_lycan_pack: getAssetPath("card_backs/cardback_lycan_pack.png"),
  cardback_four_element_street_emblem: getAssetPath("card_backs/cardback_four_element_street_emblem.png"),
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
  your_gonna_lose: getAssetPath("card_backs/your_gonna_lose.png"),
  cardback_tiny_but_mighty: getAssetPath("card_backs/cardback_tiny_but_mighty.png"),
  cardback_nature_bites_back: getAssetPath("card_backs/cardback_nature_bites_back.png"),
  cardback_cry_about_it_v2: getAssetPath("card_backs/cardback_cry_about_it_v2.png"),
  cardback_flame_tyrant: getAssetPath("card_backs/cardback_flame_tyrant.png"),
  cardback_elemental_overlord: getAssetPath("card_backs/cardback_elemental_overlord.png"),
  cardback_sweet_but_deadly: getAssetPath("card_backs/cardback_sweet_but_deadly.png"),
  cardback_too_easy: getAssetPath("card_backs/cardback_too_easy.png"),
  cardback_stay_mad: getAssetPath("card_backs/cardback_stay_mad.png"),
  cardback_void_tease: getAssetPath("card_backs/cardback_void_tease.png"),
  cardback_lucky_you: getAssetPath("card_backs/cardback_lucky_you.png"),
  cardback_king_energy: getAssetPath("card_backs/cardback_king_energy.png"),
  cardback_daily_element_chest: getAssetPath("card_backs/cardback_daily_element_chest.png")
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
  fire_variant_neon_arcana: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_neon_arcana.png") }),
  fire_variant_goldbound_relics: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_goldbound_relics.png") }),
  fire_variant_aurora_flare: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_aurora_flare.png") }),
  fire_variant_flame_wings: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_flame_wings.png") }),
  fire_variant_fire_paw: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_fire_paw.png") }),
  fire_variant_street: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_street.png") }),
  fire_variant_bane_flame: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_bane_flame.png") }),
  fire_variant_ember_core: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_ember_core.png") }),
  fire_variant_phoenix: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_phoenix.png") }),
  fire_variant_transparent_flame: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_transparent_flame.png") }),
  fire_variant_sunflare: Object.freeze({ element: "fire", image: getAssetPath("cards/fire_variant_sunflare.png") }),
  water_variant_crystal: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_crystal.png") }),
  water_variant_abyss_wave: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_abyss_wave.png") }),
  water_variant_crystal_iceburst: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_crystal_iceburst.png") }),
  water_variant_tidal_spirit: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_tidal_spirit.png") }),
  water_variant_transparent_wave: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_transparent_wave.png") }),
  water_variant_water_pillar: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_water_pillar.png") }),
  water_variant_neon_arcana: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_neon_arcana.png") }),
  water_variant_tideglass: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_tideglass.png") }),
  water_variant_goldbound_relics: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_goldbound_relics.png") }),
  water_variant_frostbloom: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_frostbloom.png") }),
  water_variant_blood_wings: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_blood_wings.png") }),
  water_variant_water_wolf: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_water_wolf.png") }),
  water_variant_street: Object.freeze({ element: "water", image: getAssetPath("cards/water_variant_street.png") }),
  earth_variant_titan: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_titan.png") }),
  earth_variant_neon_arcana: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_neon_arcana.png") }),
  earth_variant_goldbound_relics: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_goldbound_relics.png") }),
  earth_variant_icebound_crag: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_icebound_crag.png") }),
  earth_variant_stone_graves: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_stone_graves.png") }),
  earth_variant_stone_paw: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_stone_paw.png") }),
  earth_variant_street: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_street.png") }),
  earth_variant_crystal_titan: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_crystal_titan.png") }),
  earth_variant_mountain_heart: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_mountain_heart.png") }),
  earth_variant_rooted_monolith: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_rooted_monolith.png") }),
  earth_variant_stone_colossus: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_stone_colossus.png") }),
  earth_variant_transparent_crystal: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_transparent_crystal.png") }),
  earth_variant_verdant_core: Object.freeze({ element: "earth", image: getAssetPath("cards/earth_variant_verdant_core.png") }),
  wind_variant_sky_serpent: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_sky_serpent.png") }),
  wind_variant_storm_eye: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_storm_eye.png") }),
  wind_variant_neon_arcana: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_neon_arcana.png") }),
  wind_variant_goldbound_relics: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_goldbound_relics.png") }),
  wind_variant_sleet_spiral: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_sleet_spiral.png") }),
  wind_variant_wings_wind: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_wings_wind.png") }),
  wind_variant_lycan_duo: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_lycan_duo.png") }),
  wind_variant_street: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_street.png") }),
  wind_variant_transparent_vortex: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_transparent_vortex.png") }),
  wind_variant_vortex_spirit: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_vortex_spirit.png") }),
  wind_variant_whisper_spiral: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_whisper_spiral.png") }),
  wind_variant_cloudcoil: Object.freeze({ element: "wind", image: getAssetPath("cards/wind_variant_cloudcoil.png") })
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
  avatar_magma_warlord: getAssetPath("avatars/avatar_magma_warlord.png"),
  avatar_tempest_sage: getAssetPath("avatars/avatar_tempest_sage.png"),
  avatar_voidbound_entity: getAssetPath("avatars/avatar_voidbound_entity.png"),
  avatar_astral_archon: getAssetPath("avatars/avatar_astral_archon.png"),
  avatar_elemental_puppeteer: getAssetPath("avatars/avatar_elemental_puppeteer.png"),
  avatar_mimic_entity: getAssetPath("avatars/avatar_mimic_entity.png"),
  avatar_stone_colossus: getAssetPath("avatars/avatar_stone_colossus.png"),
  avatar_wind_wraith: getAssetPath("avatars/avatar_wind_wraith.png"),
  avatar_arcane_gambler: getAssetPath("avatars/avatar_arcane_gambler.png"),
  avatar_dragonkin_champion: getAssetPath("avatars/avatar_dragonkin_champion.png"),
  avatar_fairy_m: getAssetPath("avatars/avatar_fairy_m.png"),
  avatar_fairy_f: getAssetPath("avatars/avatar_fairy_f.png"),
  avatar_novice_mage: getAssetPath("avatars/avatar_novice_mage.png"),
  avatar_battle_adept: getAssetPath("avatars/avatar_battle_adept.png"),
  avatar_veteran_champion: getAssetPath("avatars/avatar_veteran_champion.png"),
  avatar_grand_archmage: getAssetPath("avatars/avatar_grand_archmage.png"),
  avatar_smirk_ember: getAssetPath("avatars/avatar_smirk_ember.png"),
  avatar_bubble_brat: getAssetPath("avatars/avatar_bubble_brat.png"),
  avatar_moss_mood: getAssetPath("avatars/avatar_moss_mood.png"),
  avatar_neon_puff: getAssetPath("avatars/avatar_neon_puff.png"),
  avatar_neon_pyre_entity: getAssetPath("avatars/avatar_neon_pyre_entity.png"),
  avatar_neon_tide_entity: getAssetPath("avatars/avatar_neon_tide_entity.png"),
  avatar_neon_stone_entity: getAssetPath("avatars/avatar_neon_stone_entity.png"),
  avatar_neon_gale_entity: getAssetPath("avatars/avatar_neon_gale_entity.png"),
  avatar_aurelian_archon: getAssetPath("avatars/avatar_aurelian_archon.png"),
  avatar_frostveil_heir: getAssetPath("avatars/avatar_frostveil_heir.png"),
  avatar_vampire_female: getAssetPath("avatars/avatar_vampire_female.png"),
  avatar_vampire_male: getAssetPath("avatars/avatar_vampire_male.png"),
  avatar_lycan_female: getAssetPath("avatars/avatar_lycan_female.png"),
  avatar_lycan_male: getAssetPath("avatars/avatar_lycan_male.png"),
  avatar_lycan_anubis: getAssetPath("avatars/avatar_lycan_anubis.png"),
  avatar_fire_street_duelist: getAssetPath("avatars/avatar_fire_street_duelist.png"),
  avatar_water_street_duelist: getAssetPath("avatars/avatar_water_street_duelist.png"),
  avatar_earth_street_duelist: getAssetPath("avatars/avatar_earth_street_duelist.png"),
  avatar_wind_street_duelist: getAssetPath("avatars/avatar_wind_street_duelist.png"),
  avatar_stone_cold_cutie: getAssetPath("avatars/avatar_stone_cold_cutie.png"),
  avatar_storm_brat: getAssetPath("avatars/avatar_storm_brat.png"),
  avatar_tidal_diva: getAssetPath("avatars/avatar_tidal_diva.png"),
  avatar_ashen_trickster: getAssetPath("avatars/avatar_ashen_trickster.png"),
  avatar_corrupt_cherub: getAssetPath("avatars/avatar_corrupt_cherub.png"),
  avatar_void_glam: getAssetPath("avatars/avatar_void_glam.png"),
  avatar_riot_halo: getAssetPath("avatars/avatar_riot_halo.png"),
  avatar_golden_menace: getAssetPath("avatars/avatar_golden_menace.png"),
  avatar_chaos_monarch: getAssetPath("avatars/avatar_chaos_monarch.png"),
  avatar_rose_riot: getAssetPath("avatars/avatar_rose_riot.png"),
  avatar_chestbound_adept: getAssetPath("avatars/avatar_chestbound_adept.png"),
  avatar_element_chosen: getAssetPath("avatars/avatar_element_chosen.png")
});

const BADGE_IMAGES = Object.freeze({
  none: null,
  war_machine_badge: getAssetPath("badges/warMachine.png"),
  supporter_badge: getAssetPath("badges/earlyAlphaTester.png"),
  badge_element_initiate: getAssetPath("badges/badge_element_initiate.png"),
  badge_arena_challenger: getAssetPath("badges/badge_arena_challenger.png"),
  badge_element_veteran: getAssetPath("badges/badge_element_veteran.png"),
  badge_arena_legend: getAssetPath("badges/badge_arena_legend.png"),
  badge_daily_emblem: getAssetPath("badges/badge_daily_emblem.png")
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
        continue;
      }

      if (typeof variantId === "string") {
        const directVariantImage = resolveDirectAssetPath(variantId);
        if (directVariantImage) {
          map[element] = directVariantImage;
        }
      }
    }
  }

  return map;
}

function resolveDirectAssetPath(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("assets/") ||
    normalized.startsWith("../") ||
    normalized.startsWith("./")
  ) {
    return normalized;
  }

  if (
    normalized.includes("/") ||
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg")
  ) {
    return getAssetPath(normalized);
  }

  return null;
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
    default_background: getAssetPath("backgrounds/default_background.png"),
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
    bg_infernal_rift: getAssetPath("backgrounds/bg_infernal_rift.png"),
    bg_aurora_sanctuary: getAssetPath("backgrounds/bg_aurora_sanctuary.png"),
    bg_abyssal_gate: getAssetPath("backgrounds/bg_abyssal_gate.png"),
    bg_sunken_ruins: getAssetPath("backgrounds/bg_sunken_ruins.png"),
    bg_crystal_nexus: getAssetPath("backgrounds/bg_crystal_nexus.png"),
    bg_stormbreaker_summit: getAssetPath("backgrounds/bg_stormbreaker_summit.png"),
    bg_celestial_observatory: getAssetPath("backgrounds/bg_celestial_observatory.png"),
    bg_verdant_overgrowth: getAssetPath("backgrounds/bg_verdant_overgrowth.png"),
    background_ancient_arena: getAssetPath("backgrounds/background_ancient_arena.png"),
    background_storm_citadel: getAssetPath("backgrounds/background_storm_citadel.png"),
    background_sky_temple: getAssetPath("backgrounds/background_sky_temple.png"),
    background_bg_lycan_law: getAssetPath("backgrounds/background_bg_lycan_law.png"),
    background_breezewild_meadow: getAssetPath("backgrounds/background_breezewild_meadow.png"),
    background_broken_yard: getAssetPath("backgrounds/background_broken_yard.png"),
    background_crystal_ruins: getAssetPath("backgrounds/background_crystal_ruins.png"),
    background_ember_pit: getAssetPath("backgrounds/background_ember_pit.png"),
    background_glowtide_flats: getAssetPath("backgrounds/background_glowtide_flats.png"),
    background_moonshade_grove: getAssetPath("backgrounds/background_moonshade_grove.png"),
    background_morning_sanctum: getAssetPath("backgrounds/background_morning_sanctum.png"),
    background_chamber_of_the_four: getAssetPath("backgrounds/background_chamber_of_the_four.png")
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
  return CARD_BACKS[cardBackId] ?? resolveDirectAssetPath(cardBackId) ?? CARD_BACKS.default_card_back;
}

export function getCardImage(element, variantMap = null) {
  const map = variantMap ?? DEFAULT_ELEMENT_IMAGES;
  return map[element] ?? DEFAULT_ELEMENT_IMAGES[element] ?? CARD_BACKS.default_card_back;
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
  return AVATAR_MAP[avatarId] ?? resolveDirectAssetPath(avatarId) ?? AVATAR_MAP.default_avatar;
}

export function getBadgeImage(badgeId = "none") {
  return BADGE_IMAGES[badgeId] ?? resolveDirectAssetPath(badgeId) ?? null;
}


