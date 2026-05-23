import { ELEMENTS } from "./rules.js";

export const DEFAULT_GAUNTLET_RIVAL_ID = "pyro_maniac";

function freezeRivalDefinition(definition) {
  if (definition.behaviorType === "weighted") {
    return Object.freeze({
      ...definition,
      weights: Object.freeze({ ...definition.weights })
    });
  }

  if (definition.behaviorType === "loop") {
    return Object.freeze({
      ...definition,
      loop: Object.freeze([...definition.loop])
    });
  }

  if (definition.behaviorType === "mimic") {
    return Object.freeze({
      ...definition,
      copyChance: Math.min(1, Math.max(0, Number(definition.copyChance ?? 0.5) || 0.5))
    });
  }

  return Object.freeze({ ...definition });
}

export const GAUNTLET_RIVAL_DEFINITIONS = Object.freeze([
  freezeRivalDefinition({
    id: "pyro_maniac",
    displayName: "Pyro Maniac",
    title: "Flame Addict",
    behaviorType: "weighted",
    hint: "Favors Fire heavily, but still mixes in other elements.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_pyro_maniac.png",
    weights: {
      fire: 50,
      earth: 20,
      wind: 20,
      water: 10
    }
  }),
  freezeRivalDefinition({
    id: "tide_witch",
    displayName: "Tide Witch",
    title: "Tidecaller",
    behaviorType: "weighted",
    hint: "Favors Water and tries to drown Fire-heavy players.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_tide_witch.png",
    weights: {
      water: 50,
      fire: 20,
      wind: 20,
      earth: 10
    }
  }),
  freezeRivalDefinition({
    id: "stonewall",
    displayName: "Stonewall",
    title: "Iron Root",
    behaviorType: "weighted",
    hint: "Favors Earth and plays a heavy defensive style.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_stonewall.png",
    weights: {
      earth: 50,
      fire: 20,
      water: 20,
      wind: 10
    }
  }),
  freezeRivalDefinition({
    id: "storm_chaser",
    displayName: "Storm Chaser",
    title: "Storm Caller",
    behaviorType: "weighted",
    hint: "Favors Wind and pressures Water-based play.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_storm_chaser.png",
    weights: {
      wind: 50,
      earth: 20,
      fire: 20,
      water: 10
    }
  }),
  freezeRivalDefinition({
    id: "inferno_drummer",
    displayName: "Inferno Drummer",
    title: "Warbeat Flame",
    behaviorType: "loop",
    hint: "Repeats a steady battle rhythm with extra Fire pressure.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_inferno_drummer.png",
    loop: ["fire", "fire", "earth", "earth", "wind", "wind", "water", "water", "earth", "earth"]
  }),
  freezeRivalDefinition({
    id: "river_spiral",
    displayName: "River Spiral",
    title: "Flow Seer",
    behaviorType: "loop",
    hint: "Repeats a flowing pattern that cycles through Water, Earth, and Wind.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_river_spiral.png",
    loop: ["water", "earth", "wind", "water", "earth", "wind", "fire", "water", "earth", "wind"]
  }),
  freezeRivalDefinition({
    id: "stone_march",
    displayName: "Stone March",
    title: "Mountain Step",
    behaviorType: "loop",
    hint: "Repeats a heavy Earth pattern with occasional elemental shifts.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_stone_march.png",
    loop: ["earth", "earth", "fire", "earth", "wind", "earth", "water", "earth", "fire", "wind"]
  }),
  freezeRivalDefinition({
    id: "fourfold_monk",
    displayName: "Fourfold Monk",
    title: "Element Keeper",
    behaviorType: "loop",
    hint: "Repeats a balanced four-element discipline pattern.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_fourfold_monk.png",
    loop: ["fire", "water", "earth", "wind", "earth", "water", "fire", "water", "earth", "wind"]
  }),
  freezeRivalDefinition({
    id: "cyclebound",
    displayName: "Cyclebound",
    title: "Keeper of the Old Rhythm",
    behaviorType: "loop",
    hint: "Their choices feel bound to an old rhythm.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_cyclebound.png",
    loop: ["fire", "earth", "wind", "water"]
  }),
  freezeRivalDefinition({
    id: "mimic_rival",
    displayName: "Mimic Rival",
    title: "The Familiar Echo",
    behaviorType: "mimic",
    hint: "Their style feels strangely familiar.",
    avatarPath: "assets/gauntlet/avatars/avatar_gauntlet_mimic_rival.png",
    copyChance: 0.5
  })
]);

const GAUNTLET_RIVAL_LOOKUP = Object.freeze(
  Object.fromEntries(GAUNTLET_RIVAL_DEFINITIONS.map((definition) => [definition.id, definition]))
);

export function normalizeGauntletRivalId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function listGauntletRivals() {
  return GAUNTLET_RIVAL_DEFINITIONS;
}

export function getGauntletRivalById(id) {
  const normalizedId = normalizeGauntletRivalId(id);
  return normalizedId ? GAUNTLET_RIVAL_LOOKUP[normalizedId] ?? null : null;
}

export function resolveGauntletRivalById(id, fallbackId = DEFAULT_GAUNTLET_RIVAL_ID) {
  return (
    getGauntletRivalById(id) ??
    getGauntletRivalById(fallbackId) ??
    GAUNTLET_RIVAL_DEFINITIONS[0] ??
    null
  );
}

export function isValidGauntletElementSequence(sequence) {
  return Array.isArray(sequence) && sequence.length > 0 && sequence.every((element) => ELEMENTS.includes(element));
}
