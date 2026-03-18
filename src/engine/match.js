import { compareElements } from "./rules.js";
import { collectCards, createDeck, shuffleDeck } from "./deck.js";
import { resolveWar, WAR_REQUIRED_CARDS } from "./war.js";

const DEFAULT_STARTING_CARDS_PER_ELEMENT = 2;

function randomSort(cards, rng) {
  return shuffleDeck(cards, rng);
}

function validateConservation(state) {
  const total =
    state.players.p1.hand.length +
    state.players.p2.hand.length +
    state.currentPile.length;

  if (total !== state.meta.totalCards) {
    throw new Error(
      `Card conservation violated. Expected ${state.meta.totalCards}, got ${total}.`
    );
  }
}

function recordMinHandCounts(state) {
  if (!state?.meta) {
    return;
  }

  const existing = state.meta.minHandSizes ?? {
    p1: state.players.p1.hand.length,
    p2: state.players.p2.hand.length
  };

  state.meta.minHandSizes = {
    p1: Math.min(existing.p1 ?? state.players.p1.hand.length, state.players.p1.hand.length),
    p2: Math.min(existing.p2 ?? state.players.p2.hand.length, state.players.p2.hand.length)
  };
}

function takeCardAt(hand, index) {
  if (hand.length === 0) return undefined;
  const safeIndex = Number.isInteger(index) ? index : 0;
  const resolved = Math.max(0, Math.min(safeIndex, hand.length - 1));
  const [card] = hand.splice(resolved, 1);
  return card;
}

export function createMatch(options = {}) {
  const {
    cardsPerElement = DEFAULT_STARTING_CARDS_PER_ELEMENT,
    rng = Math.random,
    mode = "pve",
    difficulty = "balanced"
  } = options;

  const baseHand = shuffleDeck(createDeck(cardsPerElement), rng);
  const p1Hand = [...baseHand];
  const p2Hand = shuffleDeck([...baseHand], rng);

  const totalCards = p1Hand.length + p2Hand.length;

  const state = {
    id: `match-${Date.now()}`,
    status: "active",
    round: 0,
    mode,
    difficulty,
    winner: null,
    endReason: null,
    currentPile: [],
    players: {
      p1: { hand: p1Hand, wonRounds: 0 },
      p2: { hand: p2Hand, wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: 0,
      pendingClashes: 0,
      pendingPileSizes: []
    },
    history: [],
    meta: {
      totalCards,
      minHandSizes: {
        p1: p1Hand.length,
        p2: p2Hand.length
      }
    }
  };

  validateConservation(state);
  return state;
}

function awardPile(state, roundWinner, pile, rng) {
  const capturedCards = pile.length;

  if (roundWinner === "p1") {
    collectCards(state.players.p1.hand, randomSort(pile, rng));
    state.players.p1.wonRounds += 1;
    state.currentPile = [];
    return capturedCards;
  }

  if (roundWinner === "p2") {
    collectCards(state.players.p2.hand, randomSort(pile, rng));
    state.players.p2.wonRounds += 1;
    state.currentPile = [];
    return capturedCards;
  }

  state.currentPile = pile;
  return 0;
}

function balancedOpponentCardsCaptured(pileLength) {
  return Math.max(0, Math.floor(Number(pileLength ?? 0) / 2));
}

function resolveEndState(state) {
  if (state.players.p1.hand.length === 0 && state.players.p2.hand.length === 0) {
    state.status = "completed";
    state.winner = "draw";
    return;
  }

  if (state.players.p1.hand.length === 0) {
    state.status = "completed";
    state.winner = "p2";
    return;
  }

  if (state.players.p2.hand.length === 0) {
    state.status = "completed";
    state.winner = "p1";
  }
}

function returnNoEffectCards(state, p1Card, p2Card) {
  if (p1Card) {
    collectCards(state.players.p1.hand, [p1Card]);
  }

  if (p2Card) {
    collectCards(state.players.p2.hand, [p2Card]);
  }

  state.currentPile = [];
}

function returnWarPileToOwners(state, pile) {
  const p1Cards = [];
  const p2Cards = [];

  for (let i = 0; i < pile.length; i += 1) {
    if (i % 2 === 0) {
      p1Cards.push(pile[i]);
    } else {
      p2Cards.push(pile[i]);
    }
  }

  if (p1Cards.length > 0) {
    collectCards(state.players.p1.hand, p1Cards);
  }
  if (p2Cards.length > 0) {
    collectCards(state.players.p2.hand, p2Cards);
  }
}

function finalizeRoundEntry(state, entry) {
  state.history.push(entry);
  validateConservation(state);
  return {
    state,
    skipped: false,
    round: entry,
    status: "resolved"
  };
}

function resolvePendingWarExhaustion(state, rng, currentRound, p1Card, p2Card) {
  const p1CanContinue = state.players.p1.hand.length >= WAR_REQUIRED_CARDS;
  const p2CanContinue = state.players.p2.hand.length >= WAR_REQUIRED_CARDS;
  const warPileSizes = [...state.war.pendingPileSizes];
  const warEntryPileSize = warPileSizes[0] ?? 0;

  if (p1CanContinue && p2CanContinue) {
    return null;
  }

  if (!p1CanContinue && !p2CanContinue) {
    returnWarPileToOwners(state, state.currentPile);
    state.currentPile = [];
    state.status = "completed";
    state.winner = "draw";
    state.endReason = "war-insufficient-both";
    state.war.active = false;
    state.war.pendingClashes = 0;
    state.war.pendingPileSizes = [];

    return finalizeRoundEntry(state, {
      round: currentRound,
      p1Card,
      p2Card,
      result: "draw",
      warClashes: warPileSizes.length > 0 ? warPileSizes.length - 1 : 0,
      warPileSize: 0,
      warPileSizes,
      warEntryPileSize,
      capturedCards: 0,
      capturedOpponentCards: 0
    });
  }

  const winner = p1CanContinue ? "p1" : "p2";
  const finalPileSize = state.currentPile.length;
  const capturedCards = awardPile(state, winner, state.currentPile, rng);
  const capturedOpponentCards = balancedOpponentCardsCaptured(finalPileSize);

  state.war.active = false;
  state.war.pendingClashes = 0;
  state.war.pendingPileSizes = [];
  resolveEndState(state);

  return finalizeRoundEntry(state, {
    round: currentRound,
    p1Card,
    p2Card,
    result: winner,
    warClashes: warPileSizes.length > 0 ? warPileSizes.length - 1 : 0,
    warPileSize: finalPileSize,
    warPileSizes,
    warEntryPileSize,
    capturedCards,
    capturedOpponentCards
  });
}

export function completeMatch(state, { winner = "draw", reason = "manual" } = {}) {
  if (!state || state.status !== "active") {
    return state;
  }

  state.status = "completed";
  state.winner = winner;
  state.endReason = reason;
  validateConservation(state);
  return state;
}

export function completeMatchByCardCount(state, { reason = "time_limit" } = {}) {
  if (!state || state.status !== "active") {
    return state;
  }

  const p1Cards = state.players.p1.hand.length;
  const p2Cards = state.players.p2.hand.length;

  let winner = "draw";
  if (p1Cards > p2Cards) {
    winner = "p1";
  } else if (p2Cards > p1Cards) {
    winner = "p2";
  }

  return completeMatch(state, { winner, reason });
}

export function playRound(state, options = {}) {
  if (state.status !== "active") {
    return { state, skipped: true, reason: "match-complete" };
  }

  const { rng = Math.random, p1CardIndex = 0, p2CardIndex = 0 } = options;

  const p1Card = takeCardAt(state.players.p1.hand, p1CardIndex);
  const p2Card = takeCardAt(state.players.p2.hand, p2CardIndex);
  recordMinHandCounts(state);

  if (!p1Card || !p2Card) {
    if (p1Card) state.currentPile.push(p1Card);
    if (p2Card) state.currentPile.push(p2Card);

    if (!p1Card && p2Card) {
      awardPile(state, "p2", state.currentPile, rng);
    } else if (!p2Card && p1Card) {
      awardPile(state, "p1", state.currentPile, rng);
    }

    resolveEndState(state);
    validateConservation(state);
    return { state, skipped: false, reason: "insufficient-cards" };
  }

  state.round += 1;
  state.currentPile.push(p1Card, p2Card);

  const baseResult = compareElements(p1Card, p2Card);
  let roundWinner = baseResult;
  let warResult = null;

  if (baseResult === "tie") {
    state.war.active = true;
    warResult = resolveWar(state, state.currentPile);
    roundWinner = warResult.winner;
    state.war.clashes += warResult.clashes;
    state.currentPile = warResult.pile;
    state.war.active = false;
  }

  let capturedCards = 0;
  let capturedOpponentCards = 0;
  if (baseResult === "none") {
    returnNoEffectCards(state, p1Card, p2Card);
  } else if (warResult?.winner === "draw" && warResult?.returnPileOnDraw) {
    returnWarPileToOwners(state, warResult.pile);
    state.currentPile = [];
    state.status = "completed";
    state.winner = "draw";
    state.endReason = "war-insufficient-both";
  } else {
    capturedCards = awardPile(state, roundWinner, state.currentPile, rng);
    capturedOpponentCards = balancedOpponentCardsCaptured(capturedCards);
  }

  if (state.status === "active") {
    resolveEndState(state);
  }

  const entry = {
    round: state.round,
    p1Card,
    p2Card,
    result: roundWinner,
    warClashes: warResult ? warResult.clashes : 0,
    warPileSize: warResult ? warResult.pile.length : 0,
    warPileSizes: warResult?.pileSizes ?? [],
    warEntryPileSize: warResult?.pileSizes?.[0] ?? 0,
    capturedCards,
    capturedOpponentCards
  };

  return finalizeRoundEntry(state, entry);
}

export function playRoundManualWarStep(state, options = {}) {
  if (state.status !== "active") {
    return { state, skipped: true, reason: "match-complete" };
  }

  const { rng = Math.random, p1CardIndex = 0, p2CardIndex = 0 } = options;
  const inWar = state.war.active;

  if (inWar) {
    const p1CanContinue = state.players.p1.hand.length >= WAR_REQUIRED_CARDS;
    const p2CanContinue = state.players.p2.hand.length >= WAR_REQUIRED_CARDS;

    if (!p1CanContinue && !p2CanContinue) {
      const warPileSizes = [...state.war.pendingPileSizes];
      const warEntryPileSize = warPileSizes[0] ?? 0;
      returnWarPileToOwners(state, state.currentPile);
      state.currentPile = [];
      state.status = "completed";
      state.winner = "draw";
      state.endReason = "war-insufficient-both";
      state.war.active = false;
      state.war.pendingClashes = 0;
      state.war.pendingPileSizes = [];

      const entry = {
        round: state.round || 1,
        p1Card: null,
        p2Card: null,
        result: "draw",
        warClashes: warPileSizes.length > 0 ? warPileSizes.length - 1 : 0,
        warPileSize: 0,
        warPileSizes,
        warEntryPileSize,
        capturedCards: 0,
        capturedOpponentCards: 0
      };

      return finalizeRoundEntry(state, entry);
    }

    if (!p1CanContinue || !p2CanContinue) {
      const winner = p1CanContinue ? "p1" : "p2";
      const finalPileSize = state.currentPile.length;
      const warPileSizes = [...state.war.pendingPileSizes];
      const warEntryPileSize = warPileSizes[0] ?? 0;
      const capturedCards = awardPile(state, winner, state.currentPile, rng);
      const capturedOpponentCards = balancedOpponentCardsCaptured(finalPileSize);

      state.war.active = false;
      state.war.pendingClashes = 0;
      state.war.pendingPileSizes = [];
      resolveEndState(state);

      const entry = {
        round: state.round || 1,
        p1Card: null,
        p2Card: null,
        result: winner,
        warClashes: warPileSizes.length > 0 ? warPileSizes.length - 1 : 0,
        warPileSize: finalPileSize,
        warPileSizes,
        warEntryPileSize,
        capturedCards,
        capturedOpponentCards
      };

      return finalizeRoundEntry(state, entry);
    }
  }

  const p1Card = takeCardAt(state.players.p1.hand, p1CardIndex);
  const p2Card = takeCardAt(state.players.p2.hand, p2CardIndex);
  recordMinHandCounts(state);

  if (!p1Card || !p2Card) {
    if (p1Card) {
      state.currentPile.push(p1Card);
    }
    if (p2Card) {
      state.currentPile.push(p2Card);
    }

    const winner = !p1Card && p2Card ? "p2" : !p2Card && p1Card ? "p1" : "draw";
    const capturedCards = winner === "draw" ? 0 : awardPile(state, winner, state.currentPile, rng);
    const capturedOpponentCards = winner === "draw" ? 0 : balancedOpponentCardsCaptured(capturedCards);
    resolveEndState(state);

    const entry = {
      round: state.round || 1,
      p1Card,
      p2Card,
      result: winner,
      warClashes: state.war.pendingClashes,
      warPileSize: state.currentPile.length,
      warPileSizes: [...state.war.pendingPileSizes],
      warEntryPileSize: state.war.pendingPileSizes?.[0] ?? 0,
      capturedCards,
      capturedOpponentCards
    };

    state.war.active = false;
    state.war.pendingClashes = 0;
    state.war.pendingPileSizes = [];

    return finalizeRoundEntry(state, entry);
  }

  if (!inWar) {
    state.round += 1;
    state.currentPile.push(p1Card, p2Card);
    const baseResult = compareElements(p1Card, p2Card);

    if (baseResult === "none") {
      returnNoEffectCards(state, p1Card, p2Card);
      resolveEndState(state);

      const entry = {
        round: state.round,
        p1Card,
        p2Card,
        result: "none",
        warClashes: 0,
        warPileSize: 0,
        warPileSizes: [],
        warEntryPileSize: 0,
        capturedCards: 0,
        capturedOpponentCards: 0
      };

      return finalizeRoundEntry(state, entry);
    }

    if (baseResult === "tie") {
      state.war.active = true;
      state.war.pendingClashes = 0;
      state.war.pendingPileSizes = [state.currentPile.length];
      const exhaustionResolution = resolvePendingWarExhaustion(
        state,
        rng,
        state.round,
        p1Card,
        p2Card
      );
      if (exhaustionResolution) {
        return exhaustionResolution;
      }
      validateConservation(state);
      return {
        state,
        skipped: false,
        status: "war_continues",
        round: null,
        war: {
          clashes: state.war.pendingClashes,
          pileSize: state.currentPile.length,
          pileSizes: [...state.war.pendingPileSizes]
        }
      };
    }

    const capturedCards = awardPile(state, baseResult, state.currentPile, rng);
    const capturedOpponentCards = balancedOpponentCardsCaptured(capturedCards);
    resolveEndState(state);

    const entry = {
      round: state.round,
      p1Card,
      p2Card,
      result: baseResult,
      warClashes: 0,
      warPileSize: 0,
      warPileSizes: [],
      warEntryPileSize: 0,
      capturedCards,
      capturedOpponentCards
    };

    return finalizeRoundEntry(state, entry);
  }

  state.currentPile.push(p1Card, p2Card);
  state.war.pendingClashes += 1;
  state.war.pendingPileSizes.push(state.currentPile.length);

  const result = compareElements(p1Card, p2Card);
  if (result === "tie" || result === "none") {
    const exhaustionResolution = resolvePendingWarExhaustion(
      state,
      rng,
      state.round || 1,
      p1Card,
      p2Card
    );
    if (exhaustionResolution) {
      return exhaustionResolution;
    }

    validateConservation(state);
    return {
      state,
      skipped: false,
      status: "war_continues",
      round: null,
      war: {
        clashes: state.war.pendingClashes,
        pileSize: state.currentPile.length,
        pileSizes: [...state.war.pendingPileSizes]
      }
    };
  }

  state.war.clashes += state.war.pendingClashes;
  const finalPileSize = state.currentPile.length;
  const warPileSizes = [...state.war.pendingPileSizes];
  const warEntryPileSize = warPileSizes[0] ?? 0;
  const capturedCards = awardPile(state, result, state.currentPile, rng);
  const capturedOpponentCards = balancedOpponentCardsCaptured(finalPileSize);

  state.war.active = false;
  state.war.pendingClashes = 0;
  state.war.pendingPileSizes = [];

  resolveEndState(state);

  const entry = {
    round: state.round,
    p1Card,
    p2Card,
    result,
    warClashes: warPileSizes.length > 0 ? warPileSizes.length - 1 : 0,
    warPileSize: finalPileSize,
    warPileSizes,
    warEntryPileSize,
    capturedCards,
    capturedOpponentCards
  };

  return finalizeRoundEntry(state, entry);
}

export function getMatchSummary(state) {
  return {
    id: state.id,
    status: state.status,
    winner: state.winner,
    endReason: state.endReason,
    round: state.round,
    p1Cards: state.players.p1.hand.length,
    p2Cards: state.players.p2.hand.length,
    wars: state.war.clashes,
    pileCards: state.currentPile.length
  };
}
