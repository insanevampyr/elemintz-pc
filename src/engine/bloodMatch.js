import { compareElements, ELEMENTS } from "./rules.js";

export const BLOOD_MATCH_COMBATANT_IDS = Object.freeze(["player", "vampire", "lycan"]);

export const BLOOD_MATCH_REVEAL_TYPES = Object.freeze({
  CLEAR_WINNER: "clear_winner",
  THREE_WAY_WAR: "three_way_war",
  TWO_WAY_WAR_DEFEATED_THIRD: "two_way_war_defeated_third",
  TWO_WAY_WAR_NEUTRAL_THIRD: "two_way_war_neutral_third"
});

export const BLOOD_MATCH_REQUIRED_PLAY_RESULTS = Object.freeze({
  PLAYER_LOSS: "player_loss",
  PLAYER_WIN: "player_win",
  AI_ELIMINATED_CONTINUE: "ai_eliminated_continue",
  CONTINUE: "continue"
});

export const BLOOD_MATCH_TIMEOUT_REASONS = Object.freeze({
  TIMEOUT_LEAD: "timeout_lead",
  TIMEOUT_TIE_OR_DEFICIT: "timeout_tie_or_deficit"
});

const COMBATANT_ID_SET = new Set(BLOOD_MATCH_COMBATANT_IDS);

function cloneCardEntry(entry) {
  return {
    ownerId: entry.ownerId,
    element: entry.element
  };
}

function normalizeCombatantId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!COMBATANT_ID_SET.has(normalized)) {
    throw new Error(`Invalid Blood Match combatant id: ${String(value ?? "")}`);
  }
  return normalized;
}

function normalizeElement(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!ELEMENTS.includes(normalized)) {
    throw new Error(`Invalid Blood Match element: ${String(value ?? "")}`);
  }
  return normalized;
}

function createCardEntry(ownerId, element) {
  return {
    ownerId: normalizeCombatantId(ownerId),
    element: normalizeElement(element)
  };
}

function normalizeRevealedCardEntries(revealedCards) {
  if (Array.isArray(revealedCards)) {
    const entries = revealedCards.map((entry) =>
      createCardEntry(entry?.ownerId ?? entry?.combatantId, entry?.element)
    );
    validateCompleteReveal(entries);
    return entries;
  }

  if (!revealedCards || typeof revealedCards !== "object") {
    throw new Error("Blood Match revealed cards must be an object or array.");
  }

  const entries = BLOOD_MATCH_COMBATANT_IDS.map((combatantId) =>
    createCardEntry(combatantId, revealedCards[combatantId])
  );
  validateCompleteReveal(entries);
  return entries;
}

function validateCompleteReveal(entries) {
  if (!Array.isArray(entries) || entries.length !== BLOOD_MATCH_COMBATANT_IDS.length) {
    throw new Error("Blood Match requires exactly one revealed card per combatant.");
  }

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.ownerId)) {
      throw new Error(`Duplicate Blood Match revealed combatant: ${entry.ownerId}`);
    }
    seen.add(entry.ownerId);
  }

  for (const combatantId of BLOOD_MATCH_COMBATANT_IDS) {
    if (!seen.has(combatantId)) {
      throw new Error(`Missing Blood Match revealed combatant: ${combatantId}`);
    }
  }
}

function compareEntryAgainst(left, right) {
  const result = compareElements(left.element, right.element);
  if (result === "p1") {
    return "win";
  }
  if (result === "p2") {
    return "loss";
  }
  return result;
}

function buildRevealResult({
  type,
  activeCombatantIds = [],
  excludedCombatantIds = [],
  winnerId = null,
  potCardEntries = [],
  returnedCardEntries = [],
  revealedCardEntries = [],
  classificationId = type
}) {
  return {
    type,
    activeCombatantIds: [...activeCombatantIds],
    excludedCombatantIds: [...excludedCombatantIds],
    winnerId,
    potCardEntries: potCardEntries.map(cloneCardEntry),
    returnedCardEntries: returnedCardEntries.map(cloneCardEntry),
    revealedCardEntries: revealedCardEntries.map(cloneCardEntry),
    classificationId,
    reason: classificationId
  };
}

function findClearWinner(entries) {
  const candidates = entries
    .map((entry) => {
      const outcomes = entries
        .filter((other) => other.ownerId !== entry.ownerId)
        .map((other) => compareEntryAgainst(entry, other));
      return {
        entry,
        hasLoss: outcomes.includes("loss"),
        hasWin: outcomes.includes("win")
      };
    })
    .filter((candidate) => !candidate.hasLoss && candidate.hasWin);

  return candidates.length === 1 ? candidates[0].entry.ownerId : null;
}

function groupEntriesByElement(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.element)) {
      groups.set(entry.element, []);
    }
    groups.get(entry.element).push(entry);
  }
  return groups;
}

export function classifyBloodMatchReveal(revealedCards) {
  const revealedCardEntries = normalizeRevealedCardEntries(revealedCards);
  const elementGroups = groupEntriesByElement(revealedCardEntries);

  if (elementGroups.size === 1) {
    return buildRevealResult({
      type: BLOOD_MATCH_REVEAL_TYPES.THREE_WAY_WAR,
      activeCombatantIds: BLOOD_MATCH_COMBATANT_IDS,
      potCardEntries: revealedCardEntries,
      revealedCardEntries
    });
  }

  const clearWinnerId = findClearWinner(revealedCardEntries);
  if (clearWinnerId) {
    return buildRevealResult({
      type: BLOOD_MATCH_REVEAL_TYPES.CLEAR_WINNER,
      winnerId: clearWinnerId,
      potCardEntries: revealedCardEntries,
      revealedCardEntries
    });
  }

  const tiedPair = [...elementGroups.values()].find((group) => group.length === 2) ?? null;
  if (!tiedPair) {
    throw new Error("Unable to classify Blood Match reveal.");
  }

  const third = revealedCardEntries.find((entry) => entry.element !== tiedPair[0].element);
  if (!third) {
    throw new Error("Unable to identify Blood Match third combatant.");
  }

  const tiedVersusThird = compareElements(tiedPair[0].element, third.element);
  if (tiedVersusThird === "p1") {
    return buildRevealResult({
      type: BLOOD_MATCH_REVEAL_TYPES.TWO_WAY_WAR_DEFEATED_THIRD,
      activeCombatantIds: tiedPair.map((entry) => entry.ownerId),
      excludedCombatantIds: [third.ownerId],
      potCardEntries: revealedCardEntries,
      revealedCardEntries
    });
  }

  if (tiedVersusThird === "none") {
    return buildRevealResult({
      type: BLOOD_MATCH_REVEAL_TYPES.TWO_WAY_WAR_NEUTRAL_THIRD,
      activeCombatantIds: tiedPair.map((entry) => entry.ownerId),
      excludedCombatantIds: [third.ownerId],
      potCardEntries: tiedPair,
      returnedCardEntries: [third],
      revealedCardEntries
    });
  }

  throw new Error("Unable to classify Blood Match tied reveal.");
}

export function appendBloodMatchPotEntries(existingPotEntries = [], cardEntries = []) {
  const existing = Array.isArray(existingPotEntries) ? existingPotEntries : [];
  const additions = Array.isArray(cardEntries) ? cardEntries : [];
  return [
    ...existing.map((entry) => createCardEntry(entry?.ownerId, entry?.element)),
    ...additions.map((entry) => createCardEntry(entry?.ownerId, entry?.element))
  ];
}

export function evaluateBloodMatchRequiredPlayAvailability({
  legalPlayableCardCounts = {},
  activeCombatantIds = BLOOD_MATCH_COMBATANT_IDS
} = {}) {
  const activeIds = new Set(
    (Array.isArray(activeCombatantIds) ? activeCombatantIds : BLOOD_MATCH_COMBATANT_IDS).map(
      normalizeCombatantId
    )
  );
  const cannotPlay = BLOOD_MATCH_COMBATANT_IDS.filter(
    (combatantId) =>
      activeIds.has(combatantId) &&
      Math.max(0, Number(legalPlayableCardCounts?.[combatantId] ?? 0)) <= 0
  );

  if (cannotPlay.includes("player")) {
    return {
      type: BLOOD_MATCH_REQUIRED_PLAY_RESULTS.PLAYER_LOSS,
      terminal: true,
      winnerId: null,
      loserId: "player",
      eliminatedCombatantIds: ["player"],
      remainingCombatantIds: BLOOD_MATCH_COMBATANT_IDS.filter((id) => id !== "player"),
      reason: "player_required_play_unavailable"
    };
  }

  const eliminatedAiIds = cannotPlay.filter((combatantId) => combatantId !== "player");
  const remainingAiIds = ["vampire", "lycan"].filter(
    (combatantId) => activeIds.has(combatantId) && !eliminatedAiIds.includes(combatantId)
  );
  const remainingCombatantIds = ["player", ...remainingAiIds].filter((combatantId) =>
    activeIds.has(combatantId)
  );

  if (remainingAiIds.length === 0) {
    return {
      type: BLOOD_MATCH_REQUIRED_PLAY_RESULTS.PLAYER_WIN,
      terminal: true,
      winnerId: "player",
      eliminatedCombatantIds: eliminatedAiIds,
      remainingCombatantIds: ["player"],
      reason: "all_ai_required_play_unavailable"
    };
  }

  if (eliminatedAiIds.length > 0) {
    return {
      type: BLOOD_MATCH_REQUIRED_PLAY_RESULTS.AI_ELIMINATED_CONTINUE,
      terminal: false,
      winnerId: null,
      eliminatedCombatantIds: eliminatedAiIds,
      remainingCombatantIds,
      reason: "ai_required_play_unavailable"
    };
  }

  return {
    type: BLOOD_MATCH_REQUIRED_PLAY_RESULTS.CONTINUE,
    terminal: false,
    winnerId: null,
    eliminatedCombatantIds: [],
    remainingCombatantIds,
    reason: "required_play_available"
  };
}

export function resolveBloodMatchTimeout({
  playerHandCount = 0,
  vampireHandCount = 0,
  lycanHandCount = 0,
  vampireEliminated = false,
  lycanEliminated = false
} = {}) {
  const playerCount = Math.max(0, Number(playerHandCount ?? 0));
  const survivingAiCounts = [];
  if (!vampireEliminated) {
    survivingAiCounts.push(Math.max(0, Number(vampireHandCount ?? 0)));
  }
  if (!lycanEliminated) {
    survivingAiCounts.push(Math.max(0, Number(lycanHandCount ?? 0)));
  }

  const playerStrictlyLeads = survivingAiCounts.every((count) => playerCount > count);
  const endReason = playerStrictlyLeads
    ? BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_LEAD
    : BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_TIE_OR_DEFICIT;

  return {
    type: "timeout_result",
    terminal: true,
    winnerId: playerStrictlyLeads ? "player" : null,
    loserId: playerStrictlyLeads ? null : "player",
    result: playerStrictlyLeads ? "player_win" : "player_loss",
    endReason,
    reason: endReason,
    comparedHandCounts: {
      player: playerCount,
      vampire: vampireEliminated ? null : Math.max(0, Number(vampireHandCount ?? 0)),
      lycan: lycanEliminated ? null : Math.max(0, Number(lycanHandCount ?? 0))
    },
    eliminatedCombatantIds: [
      ...(vampireEliminated ? ["vampire"] : []),
      ...(lycanEliminated ? ["lycan"] : [])
    ]
  };
}
