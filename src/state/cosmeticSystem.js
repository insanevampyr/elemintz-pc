const COSMETIC_TYPES = ["avatar", "cardBack", "background", "elementCardVariant", "badge", "title"];
const ELEMENTS = ["fire", "water", "earth", "wind"];
export const LOADOUT_UNLOCK_LEVELS = Object.freeze([10, 20, 40, 60]);
const RARITY_TIERS = Object.freeze(["Common", "Rare", "Epic", "Legendary"]);
const AVATAR_RARITY_PRICING = Object.freeze({
  Common: 150,
  Rare: 300,
  Epic: 600,
  Legendary: 900
});
const CARD_BACK_RARITY_PRICING = Object.freeze({
  Common: 120,
  Rare: 250,
  Epic: 500,
  Legendary: 800
});
const BACKGROUND_RARITY_PRICING = Object.freeze({
  Common: 90,
  Rare: 350,
  Epic: 700,
  Legendary: 1000
});
const ELEMENT_VARIANT_RARITY_PRICING = Object.freeze({
  Common: 120,
  Rare: 250,
  Epic: 450,
  Legendary: 700
});
const LEGACY_BACKGROUND_ALIASES = Object.freeze({
  default_background: "default_background",
  "EleMintzIcon.png": "default_background",
  "assets/EleMintzIcon.png": "default_background",
  "backgrounds/celestialVoidBattleArena.png": "default_background",
  "assets/backgrounds/celestialVoidBattleArena.png": "default_background",
  fire_background: "fire_background",
  "backgrounds/fireBattleArena.png": "fire_background",
  "assets/backgrounds/fireBattleArena.png": "fire_background",
  water_background: "water_background",
  "backgrounds/waterBattleArena.png": "water_background",
  "assets/backgrounds/waterBattleArena.png": "water_background",
  earth_background: "earth_background",
  "backgrounds/earthBattleArena.png": "earth_background",
  "assets/backgrounds/earthBattleArena.png": "earth_background",
  wind_background: "wind_background",
  "backgrounds/windBattleArena.png": "wind_background",
  "assets/backgrounds/windBattleArena.png": "wind_background",
  celestial_void_background: "celestial_void_background",
  "backgrounds/celestialVoidBattleArena.png#shop": "celestial_void_background",
  "assets/backgrounds/celestialVoidBattleArena.png#shop": "celestial_void_background"
});


const LEVEL_COSMETIC_UNLOCKS = Object.freeze([
  { level: 3, type: "title", id: "title_apprentice" },
  { level: 5, type: "avatar", id: "avatar_novice_mage" },
  { level: 10, type: "badge", id: "badge_element_initiate" },
  { level: 15, type: "elementCardVariant", id: "fire_variant_ember" },
  { level: 18, type: "background", id: "background_ancient_arena" },
  { level: 20, type: "title", id: "title_elementalist" },
  { level: 25, type: "avatar", id: "avatar_battle_adept" },
  { level: 30, type: "badge", id: "badge_arena_challenger" },
  { level: 40, type: "elementCardVariant", id: "water_variant_crystal" },
  { level: 45, type: "background", id: "background_storm_citadel" },
  { level: 50, type: "title", id: "title_war_master" },
  { level: 55, type: "avatar", id: "avatar_veteran_champion" },
  { level: 60, type: "badge", id: "badge_element_veteran" },
  { level: 70, type: "elementCardVariant", id: "earth_variant_titan" },
  { level: 75, type: "background", id: "background_sky_temple" },
  { level: 80, type: "title", id: "title_element_sovereign" },
  { level: 90, type: "avatar", id: "avatar_grand_archmage" },
  { level: 95, type: "badge", id: "badge_arena_legend" },
  { level: 100, type: "title", id: "title_master_elemintz" }
]);
const LEGACY_ELEMENT_VARIANT_BUNDLES = Object.freeze({
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

export const COSMETIC_CATALOG = Object.freeze({
  avatar: Object.freeze([
    {
      id: "default_avatar",
      name: "Default Avatar",
      image: "avatars/default.png",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "fireavatarF",
      name: "Fire Avatar Classic (F)",
      image: "avatars/fireavatarF.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 150
    },
    {
      id: "fireavatarM",
      name: "Fire Avatar Classic (M)",
      image: "avatars/fireavatarM.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 150
    },
    {
      id: "wateravatarF",
      name: "Water Avatar Classic (F)",
      image: "avatars/wateravatarF.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Common
    },
    {
      id: "wateravatarM",
      name: "Water Avatar Classic (M)",
      image: "avatars/wateravatarM.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Common
    },
    {
      id: "earthavatarF",
      name: "Earth Avatar Classic (F)",
      image: "avatars/earthavatarF.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Common
    },
    {
      id: "earthavatarM",
      name: "Earth Avatar Classic (M)",
      image: "avatars/earthavatarM.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Common
    },
    {
      id: "windavatarF",
      name: "Wind Avatar Classic (F)",
      image: "avatars/windavatarF.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 150
    },
    {
      id: "windavatarM",
      name: "Wind Avatar Classic (M)",
      image: "avatars/windavatarM.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 150
    },
    {
      id: "fire_avatar_f",
      name: "Fire Warden (F)",
      image: "avatars/fire_avatar_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "fire_avatar_m",
      name: "Fire Warden (M)",
      image: "avatars/fire_avatar_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "water_avatar_f",
      name: "Tide Guardian (F)",
      image: "avatars/water_avatar_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 300
    },
    {
      id: "water_avatar_m",
      name: "Tide Guardian (M)",
      image: "avatars/water_avatar_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 300
    },
    {
      id: "earth_avatar_f",
      name: "Stone Sentinel (F)",
      image: "avatars/earth_avatar_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 300
    },
    {
      id: "earth_avatar_m",
      name: "Stone Sentinel (M)",
      image: "avatars/earth_avatar_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 300
    },
    {
      id: "wind_avatar_f",
      name: "Storm Ranger (F)",
      image: "avatars/wind_avatar_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "wind_avatar_m",
      name: "Storm Ranger (M)",
      image: "avatars/wind_avatar_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_flame_spirit_f",
      name: "Flame Spirit (F)",
      image: "avatars/avatar_flame_spirit_f.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_flame_spirit_m",
      name: "Flame Spirit (M)",
      image: "avatars/avatar_flame_spirit_m.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_tidal_warden_f",
      name: "Tidal Warden (F)",
      image: "avatars/avatar_tidal_warden_f.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_tidal_warden_m",
      name: "Tidal Warden (M)",
      image: "avatars/avatar_tidal_warden_m.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_wind_whisperer_f",
      name: "Wind Whisperer (F)",
      image: "avatars/avatar_wind_whisperer_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_wind_whisperer_m",
      name: "Wind Whisperer (M)",
      image: "avatars/avatar_wind_whisperer_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_earth_titan_f",
      name: "Earth Titan (F)",
      image: "avatars/avatar_earth_titan_f.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_earth_titan_m",
      name: "Earth Titan (M)",
      image: "avatars/avatar_earth_titan_m.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_inferno_crown_f",
      name: "Inferno Crown (F)",
      image: "avatars/avatar_inferno_crown_f.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_inferno_crown_m",
      name: "Inferno Crown (M)",
      image: "avatars/avatar_inferno_crown_m.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_crystal_soul",
      name: "Crystal Soul",
      image: "avatars/avatar_crystal_soul.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_stone_guardian",
      name: "Stone Guardian",
      image: "avatars/avatar_stone_guardian.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_storm_oracle",
      name: "Storm Oracle",
      image: "avatars/avatar_storm_oracle.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_abyss_watcher",
      name: "Abyss Watcher",
      image: "avatars/avatar_abyss_watcher.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Legendary
    },
    {
      id: "avatar_fourfold_lord",
      name: "Fourfold Lord",
      image: "avatars/avatar_fourfold_lord.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Legendary
    },
    {
      id: "avatar_magma_warlord",
      name: "Magma Warlord",
      image: "avatars/avatar_magma_warlord.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_tempest_sage",
      name: "Tempest Sage",
      image: "avatars/avatar_tempest_sage.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_voidbound_entity",
      name: "Voidbound Entity",
      image: "avatars/avatar_voidbound_entity.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Legendary
    },
    {
      id: "avatar_astral_archon",
      name: "Astral Archon",
      image: "avatars/avatar_astral_archon.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Legendary
    },
    {
      id: "avatar_elemental_puppeteer",
      name: "Elemental Puppeteer",
      image: "avatars/avatar_elemental_puppeteer.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_mimic_entity",
      name: "Mimic Entity",
      image: "avatars/avatar_mimic_entity.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_stone_colossus",
      name: "Stone Colossus",
      image: "avatars/avatar_stone_colossus.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_wind_wraith",
      name: "Wind Wraith",
      image: "avatars/avatar_wind_wraith.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_arcane_gambler",
      name: "Arcane Gambler",
      image: "avatars/avatar_arcane_gambler.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Common
    },
    {
      id: "avatar_dragonkin_champion",
      name: "Dragonkin Champion",
      image: "avatars/avatar_dragonkin_champion.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Epic
    },
    {
      id: "avatar_fairy_m",
      name: "Fairy Prince",
      image: "avatars/avatar_fairy_m.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_fairy_f",
      name: "Fairy Princess",
      image: "avatars/avatar_fairy_f.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: AVATAR_RARITY_PRICING.Rare
    },
    {
      id: "avatar_novice_mage",
      name: "Novice Mage",
      image: "avatars/avatar_novice_mage.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "avatar_battle_adept",
      name: "Battle Adept",
      image: "avatars/avatar_battle_adept.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 300
    },
    {
      id: "avatar_veteran_champion",
      name: "Veteran Champion",
      image: "avatars/avatar_veteran_champion.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: false,
      price: 600
    },
    {
      id: "avatar_grand_archmage",
      name: "Grand Archmage",
      image: "avatars/avatar_grand_archmage.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 900
    }
  ]),
  cardBack: Object.freeze([
    {
      id: "default_card_back",
      name: "Default Card Back",
      image: "card_backs/default_back.jpg",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "supporter_card_back",
      name: "Supporter Card Back",
      image: "card_backs/supporter_card_back.png",
      defaultOwned: false,
      purchasable: false,
      price: 0,
      supporterOnly: false,
      storeHidden: true
    },
    {
      id: "ember_card_back",
      name: "Ember Card Back",
      image: "card_backs/ember_card_back.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "crystal_card_back",
      name: "Crystal Card Back",
      image: "card_backs/crystal_card_back.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "stone_rune_card_back",
      name: "Stone Rune Card Back",
      image: "card_backs/stone_rune_card_back.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "storm_sigil_card_back",
      name: "Storm Sigil Card Back",
      image: "card_backs/storm_sigil_card_back.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Common
    },
    {
      id: "void_card_back",
      name: "Void Card Back",
      image: "card_backs/void_card_back.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: 500
    },
    {
      id: "royal_gold_card_back",
      name: "Royal Gold Card Back",
      image: "card_backs/royal_gold_card_back.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: 500
    },
    {
      id: "arcane_library_card_back",
      name: "Arcane Library Card Back",
      image: "card_backs/arcane_library_card_back.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "cardback_arcane_galaxy",
      name: "Arcane Galaxy Card Back",
      image: "card_backs/cardback_arcane_galaxy.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "cardback_elemental_nexus",
      name: "Elemental Nexus Card Back",
      image: "card_backs/cardback_elemental_nexus.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Legendary
    },
    {
      id: "cardback_founder_ember",
      name: "Founder Ember Card Back",
      image: "card_backs/cardback_founder_ember.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Legendary
    },
    {
      id: "cardback_frozen_sigil",
      name: "Frozen Sigil Card Back",
      image: "card_backs/cardback_frozen_sigil.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "cardback_lava_core",
      name: "Lava Core Card Back",
      image: "card_backs/cardback_lava_core.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "cardback_obsidian_halo",
      name: "Obsidian Halo Card Back",
      image: "card_backs/cardback_obsidian_halo.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "cardback_storm_spiral",
      name: "Storm Spiral Card Back",
      image: "card_backs/cardback_storm_spiral.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "cardback_verdant_relic",
      name: "Verdant Relic Card Back",
      image: "card_backs/cardback_verdant_relic.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "i_dont_lose_transparent_cardback",
      name: "I Don't Lose - Transparent",
      image: "card_backs/i_dont_lose_transparent_cardback.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Legendary
    },
    {
      id: "i_dont_lose_cardback",
      name: "I Don't Lose",
      image: "card_backs/i_dont_lose_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "elemental_chest_cardback",
      name: "Elemental Treasure Core",
      image: "card_backs/elemental_chest_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "wont_take_long_cardback",
      name: "Swift Execution",
      image: "card_backs/wont_take_long_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "outplayed_too_easy_cardback",
      name: "Too Easy",
      image: "card_backs/outplayed_too_easy_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "cry_about_it_cardback",
      name: "Cry About It",
      image: "card_backs/cry_about_it_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "dreamscape_cardback",
      name: "Dreamscape Reverie",
      image: "card_backs/dreamscape_cardback.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "charmed_heart_cardback",
      name: "Enchanted Heartveil",
      image: "card_backs/charmed_heart_cardback.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Rare
    },
    {
      id: "gothic_heart_cardback",
      name: "Gothic Heart Sigil",
      image: "card_backs/gothic_heart_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "mystic_bloom_cardback",
      name: "Mystic Bloom Radiance",
      image: "card_backs/mystic_bloom_cardback.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "your_gonna_lose_2",
      name: "Infernal Mockery",
      image: "card_backs/your_gonna_lose_2.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Legendary
    },
    {
      id: "your_gonna_lose",
      name: "Flamebound Taunt",
      image: "card_backs/your_gonna_lose.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: CARD_BACK_RARITY_PRICING.Epic
    },
    {
      id: "founder_deluxe_card_back",
      name: "Founder Deluxe Card Back",
      image: "card_backs/founder_deluxe_card_back.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 800,
      supporterOnly: true
    }
  ]),
  background: Object.freeze([
    {
      id: "default_background",
      name: "EleMintz Table",
      image: "EleMintzIcon.png",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "fire_background",
      name: "Fire Arena",
      image: "backgrounds/fireBattleArena.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Common
    },
    {
      id: "water_background",
      name: "Water Arena",
      image: "backgrounds/waterBattleArena.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Common
    },
    {
      id: "earth_background",
      name: "Earth Arena",
      image: "backgrounds/earthBattleArena.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Common
    },
    {
      id: "wind_background",
      name: "Wind Arena",
      image: "backgrounds/windBattleArena.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Common
    },
    {
      id: "celestial_void_background",
      name: "Celestial Void",
      image: "backgrounds/celestialVoidBattleArena.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Legendary
    },
    {
      id: "lava_throne_background",
      name: "Lava Throne",
      image: "backgrounds/lava_throne_background.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: 700
    },
    {
      id: "frozen_temple_background",
      name: "Frozen Temple",
      image: "backgrounds/frozen_temple_background.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 350
    },
    {
      id: "ruin_arena_background",
      name: "Ruin Arena",
      image: "backgrounds/ruin_arena_background.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 90
    },
    {
      id: "celestial_chamber_background",
      name: "Celestial Chamber",
      image: "backgrounds/celestial_chamber_background.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: 700
    },
    {
      id: "storm_peak_background",
      name: "Storm Peak",
      image: "backgrounds/storm_peak_background.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 350
    },
    {
      id: "void_altar_background",
      name: "Void Altar",
      image: "backgrounds/void_altar_background.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: 1000
    },
    {
      id: "bg_ember_arena",
      name: "Ember Arena",
      image: "backgrounds/bg_ember_arena.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Rare
    },
    {
      id: "bg_sunken_court",
      name: "Sunken Court",
      image: "backgrounds/bg_sunken_court.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Rare
    },
    {
      id: "bg_verdant_shrine",
      name: "Verdant Shrine",
      image: "backgrounds/bg_verdant_shrine.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Rare
    },
    {
      id: "bg_storm_temple",
      name: "Storm Temple",
      image: "backgrounds/bg_storm_temple.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Rare
    },
    {
      id: "bg_crystal_cavern",
      name: "Crystal Cavern",
      image: "backgrounds/bg_crystal_cavern.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Epic
    },
    {
      id: "bg_moonlit_basin",
      name: "Moonlit Basin",
      image: "backgrounds/bg_moonlit_basin.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Epic
    },
    {
      id: "bg_elemental_throne",
      name: "Elemental Throne",
      image: "backgrounds/bg_elemental_throne.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Legendary
    },
    {
      id: "bg_eclipse_hall",
      name: "Eclipse Hall",
      image: "backgrounds/bg_eclipse_hall.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: BACKGROUND_RARITY_PRICING.Legendary
    }
  ,
    {
      id: "background_ancient_arena",
      name: "Ancient Arena",
      image: "backgrounds/background_ancient_arena.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "background_storm_citadel",
      name: "Storm Citadel",
      image: "backgrounds/background_storm_citadel.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 350
    },
    {
      id: "background_sky_temple",
      name: "Sky Temple",
      image: "backgrounds/background_sky_temple.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: false,
      price: 700
    }
  ]),
  elementCardVariant: Object.freeze([
    {
      id: "default_fire_card",
      name: "Core Fire",
      image: "cards/fire.jpg",
      element: "fire",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "default_water_card",
      name: "Core Water",
      image: "cards/water.jpg",
      element: "water",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "default_earth_card",
      name: "Core Earth",
      image: "cards/earth.jpg",
      element: "earth",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "default_wind_card",
      name: "Core Wind",
      image: "cards/wind.jpg",
      element: "wind",
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "arcane_fire_card",
      name: "Arcane Fire",
      image: "cards/arcaneFire.jpg",
      element: "fire",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "arcane_blue_flame_card",
      name: "Arcane Blue Flame",
      image: "arcaneBlueFlame.jpg",
      element: "fire",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "blue_fire_card",
      name: "Blue Fire",
      image: "cards/blueFire.jpg",
      element: "fire",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "classic_flame_card",
      name: "Classic Flame",
      image: "cards/classicFlame.jpg",
      element: "fire",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "arcane_water_card",
      name: "Arcane Water",
      image: "cards/waterfall.jpg",
      element: "water",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "water_pool_card",
      name: "Water Pool",
      image: "cards/waterPool.jpg",
      element: "water",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "wave_water_card",
      name: "Wave Water",
      image: "cards/wave.jpg",
      element: "water",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "arcane_earth_card",
      name: "Arcane Earth",
      image: "cards/rockShell.jpg",
      element: "earth",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "bold_earth_card",
      name: "Bold Earth",
      image: "cards/boldEarth.jpg",
      element: "earth",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    },
    {
      id: "rock_storm_card",
      name: "Rock Storm",
      image: "cards/rockStorm.jpg",
      element: "earth",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "arcane_wind_card",
      name: "Arcane Wind",
      image: "cards/tornado.jpg",
      element: "wind",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "smoke_wind_card",
      name: "Smoke Wind",
      image: "cards/smoke.jpg",
      element: "wind",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 120
    },
    {
      id: "smokey_wind_card",
      name: "Smokey Wind",
      image: "cards/smokeyWind.jpg",
      element: "wind",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: 250
    }
  ,
    {
      id: "fire_variant_ember",
      name: "Ember Fire",
      image: "cards/fire_variant_ember.png",
      element: "fire",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "water_variant_crystal",
      name: "Crystal Water",
      image: "cards/water_variant_crystal.png",
      element: "water",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 250
    },
    {
      id: "earth_variant_titan",
      name: "Titan Earth",
      image: "cards/earth_variant_titan.png",
      element: "earth",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: false,
      price: 450
    },
    {
      id: "fire_variant_blue_inferno",
      name: "Blue Inferno",
      image: "cards/fire_variant_blue_inferno.png",
      element: "fire",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "fire_variant_crownfire",
      name: "Crownfire",
      image: "cards/fire_variant_crownfire.png",
      element: "fire",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "fire_variant_ember_core",
      name: "Ember Core",
      image: "cards/fire_variant_ember_core.png",
      element: "fire",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "fire_variant_phoenix",
      name: "Phoenix Fire",
      image: "cards/fire_variant_phoenix.png",
      element: "fire",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "fire_variant_transparent_flame",
      name: "Transparent Flame",
      image: "cards/fire_variant_transparent_flame.png",
      element: "fire",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "water_variant_abyss_wave",
      name: "Abyss Wave",
      image: "cards/water_variant_abyss_wave.png",
      element: "water",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "water_variant_crystal_iceburst",
      name: "Crystal Iceburst",
      image: "cards/water_variant_crystal_iceburst.png",
      element: "water",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "water_variant_tidal_spirit",
      name: "Tidal Spirit",
      image: "cards/water_variant_tidal_spirit.png",
      element: "water",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "water_variant_transparent_wave",
      name: "Transparent Wave",
      image: "cards/water_variant_transparent_wave.png",
      element: "water",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "water_variant_water_pillar",
      name: "Water Pillar",
      image: "cards/water_variant_water_pillar.png",
      element: "water",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "earth_variant_crystal_titan",
      name: "Crystal Titan",
      image: "cards/earth_variant_crystal_titan.png",
      element: "earth",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "earth_variant_mountain_heart",
      name: "Mountain Heart",
      image: "cards/earth_variant_mountain_heart.png",
      element: "earth",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "earth_variant_rooted_monolith",
      name: "Rooted Monolith",
      image: "cards/earth_variant_rooted_monolith.png",
      element: "earth",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "earth_variant_stone_colossus",
      name: "Stone Colossus",
      image: "cards/earth_variant_stone_colossus.png",
      element: "earth",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "earth_variant_transparent_crystal",
      name: "Transparent Crystal",
      image: "cards/earth_variant_transparent_crystal.png",
      element: "earth",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "wind_variant_sky_serpent",
      name: "Sky Serpent",
      image: "cards/wind_variant_sky_serpent.png",
      element: "wind",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "wind_variant_storm_eye",
      name: "Storm Eye",
      image: "cards/wind_variant_storm_eye.png",
      element: "wind",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Epic
    },
    {
      id: "wind_variant_transparent_vortex",
      name: "Transparent Vortex",
      image: "cards/wind_variant_transparent_vortex.png",
      element: "wind",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Legendary
    },
    {
      id: "wind_variant_vortex_spirit",
      name: "Vortex Spirit",
      image: "cards/wind_variant_vortex_spirit.png",
      element: "wind",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    },
    {
      id: "wind_variant_whisper_spiral",
      name: "Whisper Spiral",
      image: "cards/wind_variant_whisper_spiral.png",
      element: "wind",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: true,
      price: ELEMENT_VARIANT_RARITY_PRICING.Rare
    }
  ]),
  badge: Object.freeze([
    {
      id: "none",
      name: "No Badge",
      image: null,
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "war_machine_badge",
      name: "War Machine Badge",
      image: "badges/warMachine.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 200,
      storeHidden: true
    },
    {
      id: "supporter_badge",
      name: "Founder Badge",
      image: "badges/earlyAlphaTester.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 500,
      supporterOnly: true
    }
  ,
    {
      id: "badge_element_initiate",
      name: "Element Initiate",
      image: "badges/badge_element_initiate.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "badge_arena_challenger",
      name: "Arena Challenger",
      image: "badges/badge_arena_challenger.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 200
    },
    {
      id: "badge_element_veteran",
      name: "Element Veteran",
      image: "badges/badge_element_veteran.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: false,
      price: 350
    },
    {
      id: "badge_arena_legend",
      name: "Arena Legend",
      image: "badges/badge_arena_legend.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 500
    }
  ]),
  title: Object.freeze([
    {
      id: "Initiate",
      name: "Initiate",
      image: null,
      defaultOwned: true,
      purchasable: false,
      price: 0
    },
    {
      id: "Flame Vanguard",
      name: "Flame Vanguard",
      image: "badges/firstFlame.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "Arena Founder",
      name: "Arena Founder",
      image: "badges/earlyTester.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 500,
      supporterOnly: true
    },
    {
      id: "Token Tycoon",
      name: "Token Tycoon",
      image: "badges/collector.png",
      rarity: "Common",
      defaultOwned: false,
      purchasable: true,
      price: 100
    }
  ,
    {
      id: "title_apprentice",
      name: "Apprentice",
      image: "titles/title_apprentice.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "title_elementalist",
      name: "Elementalist",
      image: "titles/title_elementalist.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "title_war_master",
      name: "War Master",
      image: "titles/title_war_master.png",
      rarity: "Rare",
      defaultOwned: false,
      purchasable: false,
      price: 200
    },
    {
      id: "title_element_sovereign",
      name: "Element Sovereign",
      image: "titles/title_element_sovereign.png",
      rarity: "Epic",
      defaultOwned: false,
      purchasable: false,
      price: 350
    },
    {
      id: "title_master_elemintz",
      name: "Master of EleMintz",
      image: "titles/title_master_elemintz.png",
      rarity: "Legendary",
      defaultOwned: false,
      purchasable: false,
      price: 500
    },
    {
      id: "Storm Breaker",
      name: "Storm Breaker",
      image: "badges/badge_longest_war_7.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    },
    {
      id: "Last Card Legend",
      name: "Last Card Legend",
      image: "badges/badge_comeback_win_25.png",
      defaultOwned: false,
      purchasable: false,
      price: 0
    }
  ])
});

const ACHIEVEMENT_COSMETIC_REWARDS = Object.freeze({
  first_flame: [{ type: "title", id: "Flame Vanguard" }],
  war_machine: [{ type: "badge", id: "war_machine_badge" }],
  longest_war_7: [{ type: "title", id: "Storm Breaker" }],
  comeback_win_25: [{ type: "title", id: "Last Card Legend" }]
});

function buildUnlockMap() {
  const map = new Map();

  for (const [achievementId, rewards] of Object.entries(ACHIEVEMENT_COSMETIC_REWARDS)) {
    for (const reward of rewards) {
      map.set(`${reward.type}:${reward.id}`, {
        type: "achievement reward",
        achievementId
      });
    }
  }

  for (const reward of LEVEL_COSMETIC_UNLOCKS) {
    map.set(`${reward.type}:${reward.id}`, {
      type: "level reward",
      level: reward.level
    });
  }

  return map;
}

const UNLOCK_MAP = buildUnlockMap();

function normalizeRarity(value) {
  return RARITY_TIERS.includes(value) ? value : "Common";
}

function defaultOwnedMap() {
  return {
    avatar: COSMETIC_CATALOG.avatar.filter((item) => item.defaultOwned).map((item) => item.id),
    cardBack: COSMETIC_CATALOG.cardBack.filter((item) => item.defaultOwned).map((item) => item.id),
    background: COSMETIC_CATALOG.background
      .filter((item) => item.defaultOwned)
      .map((item) => item.id),
    elementCardVariant: COSMETIC_CATALOG.elementCardVariant
      .filter((item) => item.defaultOwned)
      .map((item) => item.id),
    badge: COSMETIC_CATALOG.badge.filter((item) => item.defaultOwned).map((item) => item.id),
    title: COSMETIC_CATALOG.title.filter((item) => item.defaultOwned).map((item) => item.id)
  };
}

function defaultEquippedMap() {
  return {
    avatar: "default_avatar",
    cardBack: "default_card_back",
    background: "default_background",
    elementCardVariant: {
      fire: "default_fire_card",
      water: "default_water_card",
      earth: "default_earth_card",
      wind: "default_wind_card"
    },
    badge: "none",
    title: "Initiate"
  };
}

function unique(values) {
  return [...new Set(values)];
}

function safeOwned(type, owned) {
  const catalogIds = new Set(COSMETIC_CATALOG[type].map((item) => item.id));
  const filtered = (Array.isArray(owned) ? owned : []).filter((item) => catalogIds.has(item));
  return unique(filtered);
}

function safeEquipped(type, value, fallback) {
  const catalogIds = new Set(COSMETIC_CATALOG[type].map((item) => item.id));
  return catalogIds.has(value) ? value : fallback;
}

function normalizeBackgroundValue(value) {
  if (!value) {
    return null;
  }

  return LEGACY_BACKGROUND_ALIASES[value] ?? null;
}

function expandLegacyBackgroundOwned(ownedValues) {
  const values = Array.isArray(ownedValues) ? ownedValues : [];
  return values
    .map((value) => normalizeBackgroundValue(value) ?? value)
    .filter(Boolean);
}

function safeEquippedBackground(value, fallback) {
  const normalized = normalizeBackgroundValue(value) ?? value;
  return safeEquipped("background", normalized, fallback);
}

function expandLegacyElementVariantOwned(ownedValues) {
  const values = Array.isArray(ownedValues) ? [...ownedValues] : [];
  const next = [];

  for (const value of values) {
    if (LEGACY_ELEMENT_VARIANT_BUNDLES[value]) {
      next.push(...Object.values(LEGACY_ELEMENT_VARIANT_BUNDLES[value]));
      continue;
    }

    next.push(value);
  }

  return next;
}

function safeEquippedElementVariants(value, fallback) {
  const byId = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));
  const next = { ...fallback };

  if (typeof value === "string" && LEGACY_ELEMENT_VARIANT_BUNDLES[value]) {
    return { ...LEGACY_ELEMENT_VARIANT_BUNDLES[value] };
  }

  if (typeof value === "string" && byId.has(value)) {
    const item = byId.get(value);
    next[item.element] = value;
    return next;
  }

  if (!value || typeof value !== "object") {
    return next;
  }

  for (const element of ELEMENTS) {
    const id = value[element];
    if (!byId.has(id)) {
      continue;
    }

    const item = byId.get(id);
    if (item.element === element) {
      next[element] = id;
    }
  }

  return next;
}

function ensureDefaultOwned(owned) {
  for (const type of COSMETIC_TYPES) {
    const defaults = COSMETIC_CATALOG[type]
      .filter((item) => item.defaultOwned)
      .map((item) => item.id);

    for (const id of defaults) {
      if (!owned[type].includes(id)) {
        owned[type].push(id);
      }
    }
  }
}

function migrateSupporterCardBackOwnership(profile, owned, equipped) {
  const isSupporter = Boolean(profile?.supporterPass ?? profile?.supporter ?? false);
  const legacyId = "supporter_card_back";
  const founderId = "founder_deluxe_card_back";

  owned.cardBack = owned.cardBack.filter((id) => id !== legacyId);

  if (isSupporter && !owned.cardBack.includes(founderId)) {
    owned.cardBack.push(founderId);
  }

  if (equipped.cardBack === legacyId) {
    equipped.cardBack = isSupporter ? founderId : "default_card_back";
  }
}

function ensureOwnedContainsEquipped(owned, equipped) {
  for (const type of COSMETIC_TYPES) {
    if (type === "elementCardVariant") {
      for (const id of Object.values(equipped.elementCardVariant)) {
        if (!owned.elementCardVariant.includes(id)) {
          owned.elementCardVariant.push(id);
        }
      }
      continue;
    }

    if (!owned[type].includes(equipped[type])) {
      owned[type].push(equipped[type]);
    }
  }
}

function getUnlockSource(type, item) {
  if (item.defaultOwned) {
    return { type: "default", achievementId: null };
  }

  if (item.supporterOnly) {
    return { type: "supporter", achievementId: null };
  }

  if (item.purchasable) {
    return { type: "store", achievementId: null };
  }

  return UNLOCK_MAP.get(`${type}:${item.id}`) ?? { type: "locked", achievementId: null, level: null };
}

export function createDefaultCosmeticsState() {
  const owned = defaultOwnedMap();
  const equipped = defaultEquippedMap();
  const cosmeticLoadouts = LOADOUT_UNLOCK_LEVELS.map((_, index) => ({
    name: `Loadout ${index + 1}`,
    cosmetics: null
  }));

  return {
    randomizeBackgroundEachMatch: false,
    cosmeticLoadouts,
    acknowledgedLoadoutUnlockSlots: {},
    ownedCosmetics: owned,
    equippedCosmetics: equipped,
    cosmetics: {
      avatar: equipped.avatar,
      cardBack: equipped.cardBack,
      background: equipped.background,
      badge: equipped.badge
    },
    title: equipped.title
  };
}

function normalizeLoadoutNoticeMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, seen]) => Boolean(seen))
      .map(([slotKey]) => [String(slotKey), true])
  );
}

function fallbackLoadoutName(index, value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : `Loadout ${index + 1}`;
}

function normalizeLoadoutCosmeticsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const defaults = defaultEquippedMap();
  return {
    avatar: safeEquipped("avatar", value.avatar, defaults.avatar),
    cardBack: safeEquipped("cardBack", value.cardBack, defaults.cardBack),
    background: safeEquippedBackground(value.background, defaults.background),
    badge: safeEquipped("badge", value.badge, defaults.badge),
    title: safeEquipped("title", value.title, defaults.title),
    elementCardVariant: safeEquippedElementVariants(value.elementCardVariant, defaults.elementCardVariant)
  };
}

function normalizeLoadoutSlot(slot, index) {
  return {
    name: fallbackLoadoutName(index, slot?.name),
    cosmetics: normalizeLoadoutCosmeticsSnapshot(slot?.cosmetics)
  };
}

function normalizeLoadoutSlots(value) {
  const defaults = createDefaultCosmeticsState().cosmeticLoadouts;
  return LOADOUT_UNLOCK_LEVELS.map((_, index) =>
    normalizeLoadoutSlot(Array.isArray(value) ? value[index] : defaults[index], index)
  );
}

function buildLoadoutSnapshot(equippedCosmetics) {
  const normalized = safeEquippedElementVariants(
    equippedCosmetics?.elementCardVariant,
    defaultEquippedMap().elementCardVariant
  );

  return {
    avatar: equippedCosmetics?.avatar ?? defaultEquippedMap().avatar,
    cardBack: equippedCosmetics?.cardBack ?? defaultEquippedMap().cardBack,
    background: equippedCosmetics?.background ?? defaultEquippedMap().background,
    badge: equippedCosmetics?.badge ?? defaultEquippedMap().badge,
    title: equippedCosmetics?.title ?? defaultEquippedMap().title,
    elementCardVariant: normalized
  };
}

function getOwnedSet(profile, type) {
  return new Set(profile?.ownedCosmetics?.[type] ?? []);
}

function resolveLoadoutCosmeticId(profile, type, requestedId, currentId, fallbackId) {
  const owned = getOwnedSet(profile, type);
  if (requestedId && owned.has(requestedId) && getCosmeticDefinition(type, requestedId)) {
    return requestedId;
  }

  if (currentId && owned.has(currentId) && getCosmeticDefinition(type, currentId)) {
    return currentId;
  }

  if (owned.has(fallbackId) && getCosmeticDefinition(type, fallbackId)) {
    return fallbackId;
  }

  return fallbackId;
}

function resolveLoadoutVariantId(profile, element, requestedId, currentId, fallbackId) {
  const owned = getOwnedSet(profile, "elementCardVariant");
  const definition = requestedId ? getCosmeticDefinition("elementCardVariant", requestedId) : null;
  if (requestedId && owned.has(requestedId) && definition?.element === element) {
    return requestedId;
  }

  const currentDefinition = currentId ? getCosmeticDefinition("elementCardVariant", currentId) : null;
  if (currentId && owned.has(currentId) && currentDefinition?.element === element) {
    return currentId;
  }

  const fallbackDefinition = fallbackId ? getCosmeticDefinition("elementCardVariant", fallbackId) : null;
  if (fallbackId && owned.has(fallbackId) && fallbackDefinition?.element === element) {
    return fallbackId;
  }

  return fallbackId;
}

export function getUnlockedLoadoutSlotCount(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  return LOADOUT_UNLOCK_LEVELS.filter((unlockLevel) => safeLevel >= unlockLevel).length;
}

export function normalizeProfileCosmetics(profile) {
  const defaults = createDefaultCosmeticsState();
  const source = profile ?? {};
  const { loadoutUnlockNoticesSeen: _legacyLoadoutUnlockNoticesSeen, ...profileWithoutLegacyNoticeField } = source;

  const owned = {
    avatar: safeOwned("avatar", profile.ownedCosmetics?.avatar ?? defaults.ownedCosmetics.avatar),
    cardBack: safeOwned(
      "cardBack",
      profile.ownedCosmetics?.cardBack ?? defaults.ownedCosmetics.cardBack
    ),
    background: safeOwned(
      "background",
      expandLegacyBackgroundOwned(
        profile.ownedCosmetics?.background ?? defaults.ownedCosmetics.background
      )
    ),
    elementCardVariant: safeOwned(
      "elementCardVariant",
      expandLegacyElementVariantOwned(
        profile.ownedCosmetics?.elementCardVariant ?? defaults.ownedCosmetics.elementCardVariant
      )
    ),
    badge: safeOwned("badge", profile.ownedCosmetics?.badge ?? defaults.ownedCosmetics.badge),
    title: safeOwned("title", profile.ownedCosmetics?.title ?? defaults.ownedCosmetics.title)
  };

  const equipped = {
    avatar: safeEquipped(
      "avatar",
      profile.equippedCosmetics?.avatar ?? profile.cosmetics?.avatar,
      defaults.equippedCosmetics.avatar
    ),
    cardBack: safeEquipped(
      "cardBack",
      profile.equippedCosmetics?.cardBack ?? profile.cosmetics?.cardBack,
      defaults.equippedCosmetics.cardBack
    ),
    background: safeEquippedBackground(
      profile.equippedCosmetics?.background ?? profile.cosmetics?.background,
      defaults.equippedCosmetics.background
    ),
    elementCardVariant: safeEquippedElementVariants(
      profile.equippedCosmetics?.elementCardVariant,
      defaults.equippedCosmetics.elementCardVariant
    ),
    badge: safeEquipped(
      "badge",
      profile.equippedCosmetics?.badge ?? profile.cosmetics?.badge,
      defaults.equippedCosmetics.badge
    ),
    title: safeEquipped(
      "title",
      profile.equippedCosmetics?.title ?? profile.title,
      defaults.equippedCosmetics.title
    )
  };

  migrateSupporterCardBackOwnership(profile, owned, equipped);
  ensureDefaultOwned(owned);
  ensureOwnedContainsEquipped(owned, equipped);

  return {
    ...profileWithoutLegacyNoticeField,
    randomizeBackgroundEachMatch: Boolean(
      profile?.randomizeBackgroundEachMatch ?? defaults.randomizeBackgroundEachMatch
    ),
    cosmeticLoadouts: normalizeLoadoutSlots(profile?.cosmeticLoadouts ?? defaults.cosmeticLoadouts),
    acknowledgedLoadoutUnlockSlots: normalizeLoadoutNoticeMap(
      profile?.acknowledgedLoadoutUnlockSlots ??
        profile?.loadoutUnlockNoticesSeen ??
        defaults.acknowledgedLoadoutUnlockSlots
    ),
    ownedCosmetics: {
      avatar: unique(owned.avatar),
      cardBack: unique(owned.cardBack),
      background: unique(owned.background),
      elementCardVariant: unique(owned.elementCardVariant),
      badge: unique(owned.badge),
      title: unique(owned.title)
    },
    equippedCosmetics: equipped,
    cosmetics: {
      avatar: equipped.avatar,
      cardBack: equipped.cardBack,
      background: equipped.background,
      badge: equipped.badge
    },
    title: equipped.title
  };
}

export function getCosmeticCatalogForProfile(profile) {
  const normalized = normalizeProfileCosmetics(profile);

  return Object.fromEntries(
    COSMETIC_TYPES.map((type) => [
      type,
      COSMETIC_CATALOG[type].map((item) => {
        const unlockSource = getUnlockSource(type, item);

        return {
          ...item,
          rarity: normalizeRarity(item.rarity),
          owned: normalized.ownedCosmetics[type].includes(item.id),
          equipped:
            type === "elementCardVariant"
              ? normalized.equippedCosmetics.elementCardVariant?.[item.element] === item.id
              : normalized.equippedCosmetics[type] === item.id,
          unlockSource
        };
      })
    ])
  );
}

export function getCosmeticDefinition(type, id) {
  if (!COSMETIC_TYPES.includes(type)) {
    return null;
  }

  return COSMETIC_CATALOG[type].find((item) => item.id === id) ?? null;
}

export function getCosmeticDisplayName(type, id, fallback = null) {
  if (!id) {
    return fallback;
  }

  const definition = getCosmeticDefinition(type, id);
  if (definition?.name) {
    return definition.name;
  }

  return fallback ?? id;
}

export function equipCosmetic(profile, type, id) {
  const normalized = normalizeProfileCosmetics(profile);

  if (!COSMETIC_TYPES.includes(type)) {
    throw new Error(`Unknown cosmetic type '${type}'.`);
  }

  if (!normalized.ownedCosmetics[type].includes(id)) {
    throw new Error(`Cosmetic '${id}' is not owned for type '${type}'.`);
  }

  let next = null;

  if (type === "elementCardVariant") {
    const variant = COSMETIC_CATALOG.elementCardVariant.find((item) => item.id === id);
    const current = normalized.equippedCosmetics.elementCardVariant ?? defaultEquippedMap().elementCardVariant;

    next = {
      ...normalized,
      equippedCosmetics: {
        ...normalized.equippedCosmetics,
        elementCardVariant: {
          ...current,
          [variant.element]: id
        }
      }
    };
  } else {
    next = {
      ...normalized,
      equippedCosmetics: {
        ...normalized.equippedCosmetics,
        [type]: id
      }
    };
  }

  return normalizeProfileCosmetics(next);
}

export function getCosmeticLoadoutsForProfile(profile) {
  const normalized = normalizeProfileCosmetics(profile);
  const unlockedCount = getUnlockedLoadoutSlotCount(normalized.playerLevel ?? 1);
  const equippedSnapshot = buildLoadoutSnapshot(normalized.equippedCosmetics);

  return normalized.cosmeticLoadouts.map((slot, index) => {
    const slotNumber = index + 1;
    const unlockLevel = LOADOUT_UNLOCK_LEVELS[index];
    const hasSavedLoadout = Boolean(slot?.cosmetics);
    const isActive =
      hasSavedLoadout && JSON.stringify(slot.cosmetics) === JSON.stringify(equippedSnapshot);

    return {
      index,
      slotNumber,
      unlockLevel,
      unlocked: index < unlockedCount,
      name: fallbackLoadoutName(index, slot?.name),
      hasSavedLoadout,
      isActive
    };
  });
}

export function saveCosmeticLoadout(profile, slotIndex) {
  const normalized = normalizeProfileCosmetics(profile);
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || index >= LOADOUT_UNLOCK_LEVELS.length) {
    throw new Error(`Invalid loadout slot '${slotIndex}'.`);
  }

  if (index >= getUnlockedLoadoutSlotCount(normalized.playerLevel ?? 1)) {
    throw new Error(`Loadout slot ${index + 1} is locked.`);
  }

  const nextLoadouts = normalized.cosmeticLoadouts.map((slot, currentIndex) =>
    currentIndex === index
      ? {
          ...slot,
          name: fallbackLoadoutName(currentIndex, slot?.name),
          cosmetics: buildLoadoutSnapshot(normalized.equippedCosmetics)
        }
      : slot
  );

  return normalizeProfileCosmetics({
    ...normalized,
    cosmeticLoadouts: nextLoadouts
  });
}

export function renameCosmeticLoadout(profile, slotIndex, nextName) {
  const normalized = normalizeProfileCosmetics(profile);
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || index >= LOADOUT_UNLOCK_LEVELS.length) {
    throw new Error(`Invalid loadout slot '${slotIndex}'.`);
  }

  if (index >= getUnlockedLoadoutSlotCount(normalized.playerLevel ?? 1)) {
    throw new Error(`Loadout slot ${index + 1} is locked.`);
  }

  const nextLoadouts = normalized.cosmeticLoadouts.map((slot, currentIndex) =>
    currentIndex === index
      ? {
          ...slot,
          name: fallbackLoadoutName(currentIndex, nextName)
        }
      : slot
  );

  return normalizeProfileCosmetics({
    ...normalized,
    cosmeticLoadouts: nextLoadouts
  });
}

export function applyCosmeticLoadout(profile, slotIndex) {
  const normalized = normalizeProfileCosmetics(profile);
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || index >= LOADOUT_UNLOCK_LEVELS.length) {
    throw new Error(`Invalid loadout slot '${slotIndex}'.`);
  }

  if (index >= getUnlockedLoadoutSlotCount(normalized.playerLevel ?? 1)) {
    throw new Error(`Loadout slot ${index + 1} is locked.`);
  }

  const slot = normalized.cosmeticLoadouts[index];
  if (!slot?.cosmetics) {
    throw new Error(`Loadout slot ${index + 1} has no saved cosmetics.`);
  }

  const defaults = defaultEquippedMap();
  const current = normalized.equippedCosmetics;
  const snapshot = slot.cosmetics;
  const nextEquipped = {
    avatar: resolveLoadoutCosmeticId(normalized, "avatar", snapshot.avatar, current.avatar, defaults.avatar),
    cardBack: resolveLoadoutCosmeticId(
      normalized,
      "cardBack",
      snapshot.cardBack,
      current.cardBack,
      defaults.cardBack
    ),
    background: resolveLoadoutCosmeticId(
      normalized,
      "background",
      snapshot.background,
      current.background,
      defaults.background
    ),
    badge: resolveLoadoutCosmeticId(normalized, "badge", snapshot.badge, current.badge, defaults.badge),
    title: resolveLoadoutCosmeticId(normalized, "title", snapshot.title, current.title, defaults.title),
    elementCardVariant: Object.fromEntries(
      ELEMENTS.map((element) => [
        element,
        resolveLoadoutVariantId(
          normalized,
          element,
          snapshot.elementCardVariant?.[element],
          current.elementCardVariant?.[element],
          defaults.elementCardVariant[element]
        )
      ])
    )
  };

  return normalizeProfileCosmetics({
    ...normalized,
    equippedCosmetics: nextEquipped
  });
}

export function acknowledgeUnlockedLoadoutSlots(profile) {
  const normalized = normalizeProfileCosmetics(profile);
  const unlockedCount = getUnlockedLoadoutSlotCount(normalized.playerLevel ?? 1);
  const seen = { ...normalized.acknowledgedLoadoutUnlockSlots };
  const newlyUnlockedSlots = [];

  for (let index = 0; index < unlockedCount; index += 1) {
    const slotNumber = index + 1;
    if (!seen[String(slotNumber)]) {
      seen[String(slotNumber)] = true;
      newlyUnlockedSlots.push(slotNumber);
    }
  }

  const nextUnlockLevel = LOADOUT_UNLOCK_LEVELS[unlockedCount] ?? null;

  return {
    profile:
      newlyUnlockedSlots.length > 0
        ? normalizeProfileCosmetics({
            ...normalized,
            acknowledgedLoadoutUnlockSlots: seen
          })
        : normalized,
    newlyUnlockedSlots,
    nextUnlockLevel
  };
}

export function applyAchievementCosmeticRewards(profile, unlockedAchievements) {
  let next = normalizeProfileCosmetics(profile);
  const grantedRewards = [];

  for (const achievement of unlockedAchievements) {
    const rewards = ACHIEVEMENT_COSMETIC_REWARDS[achievement.id] ?? [];

    for (const reward of rewards) {
      if (!next.ownedCosmetics[reward.type].includes(reward.id)) {
        const nextOwned = {
          ...next.ownedCosmetics,
          [reward.type]: [...next.ownedCosmetics[reward.type], reward.id]
        };

        next = normalizeProfileCosmetics({
          ...next,
          ownedCosmetics: nextOwned
        });

        grantedRewards.push({
          type: reward.type,
          id: reward.id,
          achievementId: achievement.id
        });
      }
    }
  }

  return {
    profile: next,
    grantedRewards
  };
}

export function getSupporterRewards() {
  const rewards = [];

  for (const type of COSMETIC_TYPES) {
    for (const item of COSMETIC_CATALOG[type]) {
      if (item.supporterOnly) {
        rewards.push({ type, id: item.id });
      }
    }
  }

  return rewards;
}









