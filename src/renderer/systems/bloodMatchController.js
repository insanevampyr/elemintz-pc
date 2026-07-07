import {
  appendBloodMatchPotEntries,
  BLOOD_MATCH_COMBATANT_IDS,
  BLOOD_MATCH_REVEAL_TYPES,
  classifyBloodMatchReveal,
  evaluateBloodMatchRequiredPlayAvailability,
  resolveBloodMatchTimeout
} from "../../engine/bloodMatch.js";
import { ELEMENTS, compareElements } from "../../engine/rules.js";
import { WAR_REQUIRED_CARDS } from "../../engine/war.js";
import { chooseGauntletRivalCardIndex } from "../../engine/ai.js";
import { getGauntletRivalById } from "../../engine/gauntletRivals.js";
import {
  AI_TURN_PACING_PROFILES,
  calculateAiTurnPacingDelayMs
} from "./aiTurnPacing.js";

export const BLOOD_MATCH_RIVAL_IDS = Object.freeze({
  vampire: "vampire_rival",
  lycan: "lycan_rival"
});

const DEFAULT_HAND = Object.freeze([
  "fire",
  "fire",
  "water",
  "water",
  "earth",
  "earth",
  "wind",
  "wind"
]);

const NOOP = () => {};

function normalizeElement(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ELEMENTS.includes(normalized) ? normalized : null;
}

function cloneCardEntry(entry) {
  return {
    ownerId: entry.ownerId,
    element: entry.element
  };
}

function normalizeHand(hand = DEFAULT_HAND) {
  return (Array.isArray(hand) ? hand : DEFAULT_HAND)
    .map(normalizeElement)
    .filter(Boolean);
}

function cloneCombatant(combatant) {
  return {
    id: combatant.id,
    name: combatant.name,
    rivalId: combatant.rivalId,
    hand: [...combatant.hand],
    capturedCards: combatant.capturedCards.map(cloneCardEntry),
    recentMoves: [...combatant.recentMoves],
    eliminated: Boolean(combatant.eliminated)
  };
}

function cloneHistorySummary(entry = {}) {
  return {
    type: String(entry?.type ?? "").trim() || null,
    classificationId: String(entry?.classificationId ?? "").trim() || null,
    reason: String(entry?.reason ?? "").trim() || null,
    winnerId: String(entry?.winnerId ?? "").trim() || null,
    activeCombatantIds: Array.isArray(entry?.activeCombatantIds)
      ? entry.activeCombatantIds.filter((id) => BLOOD_MATCH_COMBATANT_IDS.includes(id))
      : [],
    excludedCombatantIds: Array.isArray(entry?.excludedCombatantIds)
      ? entry.excludedCombatantIds.filter((id) => BLOOD_MATCH_COMBATANT_IDS.includes(id))
      : []
  };
}

function buildElementCounts(cards = []) {
  const counts = Object.fromEntries(ELEMENTS.map((element) => [element, 0]));
  for (const card of Array.isArray(cards) ? cards : []) {
    const element = normalizeElement(card);
    if (element) {
      counts[element] += 1;
    }
  }
  return counts;
}

function deriveFatiguedElement(recentMoves = []) {
  const moves = (Array.isArray(recentMoves) ? recentMoves : []).map(normalizeElement).filter(Boolean);
  const last = moves.at(-1) ?? null;
  const prior = moves.at(-2) ?? null;
  return last && last === prior ? last : null;
}

function getBlockedFatiguedElement(hand = [], recentMoves = []) {
  const fatiguedElement = deriveFatiguedElement(recentMoves);
  if (!fatiguedElement) {
    return null;
  }

  const counts = buildElementCounts(hand);
  if ((counts[fatiguedElement] ?? 0) <= 0) {
    return null;
  }

  const hasAlternative = ELEMENTS.some(
    (element) => element !== fatiguedElement && (counts[element] ?? 0) > 0
  );
  return hasAlternative ? fatiguedElement : null;
}

function createDefaultCombatants({ playerName = "Player", initialHands = {} } = {}) {
  const vampire = getGauntletRivalById(BLOOD_MATCH_RIVAL_IDS.vampire);
  const lycan = getGauntletRivalById(BLOOD_MATCH_RIVAL_IDS.lycan);

  return {
    player: {
      id: "player",
      name: String(playerName ?? "Player").trim() || "Player",
      rivalId: null,
      hand: normalizeHand(Object.hasOwn(initialHands, "player") ? initialHands.player : DEFAULT_HAND),
      capturedCards: [],
      recentMoves: [],
      eliminated: false
    },
    vampire: {
      id: "vampire",
      name: vampire?.displayName ?? "Countess Veyra",
      rivalId: BLOOD_MATCH_RIVAL_IDS.vampire,
      hand: normalizeHand(Object.hasOwn(initialHands, "vampire") ? initialHands.vampire : DEFAULT_HAND),
      capturedCards: [],
      recentMoves: [],
      eliminated: false
    },
    lycan: {
      id: "lycan",
      name: lycan?.displayName ?? "Ravena Moonfang",
      rivalId: BLOOD_MATCH_RIVAL_IDS.lycan,
      hand: normalizeHand(Object.hasOwn(initialHands, "lycan") ? initialHands.lycan : DEFAULT_HAND),
      capturedCards: [],
      recentMoves: [],
      eliminated: false
    }
  };
}

function removeFirstMatchingCard(hand, element) {
  const index = hand.findIndex((card) => normalizeElement(card) === element);
  if (index < 0) {
    return null;
  }
  return hand.splice(index, 1)[0] ?? null;
}

function removeCardAt(hand, index) {
  const normalizedIndex = Number.isInteger(index) ? index : -1;
  if (normalizedIndex < 0 || normalizedIndex >= hand.length) {
    return null;
  }
  return hand.splice(normalizedIndex, 1)[0] ?? null;
}

function sortCombatantIds(ids = []) {
  const idSet = new Set(ids);
  return BLOOD_MATCH_COMBATANT_IDS.filter((id) => idSet.has(id));
}

function compareTwoCombatantEntries(left, right) {
  const comparison = compareElements(left.element, right.element);
  if (comparison === "p1") {
    return left.ownerId;
  }
  if (comparison === "p2") {
    return right.ownerId;
  }
  return null;
}

export class BloodMatchController {
  constructor(options = {}) {
    this.playerName = options.playerName ?? options.username ?? "Player";
    this.initialHands = options.initialHands ?? {};
    this.aiChooser = typeof options.aiChooser === "function" ? options.aiChooser : null;
    this.rng = typeof options.rng === "function" ? options.rng : Math.random;
    this.aiPacingRandom = typeof options.aiPacingRandom === "function" ? options.aiPacingRandom : Math.random;
    this.timerDefault = Math.max(0, Number(options.timerSeconds ?? 30));
    this.matchTimeLimitSeconds = Math.max(0, Number(options.matchTimeLimitSeconds ?? 300));
    this.scheduler = options.scheduler ?? globalThis;
    this.onUpdate = options.onUpdate ?? NOOP;
    this.onMatchComplete = options.onMatchComplete ?? NOOP;
    this.onRoundResolved = options.onRoundResolved ?? NOOP;

    this.match = null;
    this.timerSeconds = this.timerDefault;
    this.totalMatchSeconds = this.matchTimeLimitSeconds;
    this.timerId = null;
    this.matchClockId = null;
    this.isResolving = false;
    this.completionNotified = false;
    this.aiThinking = false;
    this.pendingPlayerElement = null;
    this.pendingAiPacingDelay = null;
    this.aiPacingGeneration = 0;
  }

  startMatch() {
    this.stopTimers();
    this.cancelPendingAiPacing({ notify: false });
    this.aiPacingGeneration += 1;
    this.match = {
      mode: "blood_match",
      status: "active",
      combatants: createDefaultCombatants({
        playerName: this.playerName,
        initialHands: this.initialHands
      }),
      round: 1,
      history: [],
      potCardEntries: [],
      war: {
        active: false,
        activeCombatantIds: [],
        clashes: 0
      },
      terminalResult: null,
      winnerId: null,
      endReason: null
    };
    this.timerSeconds = this.timerDefault;
    this.totalMatchSeconds = this.matchTimeLimitSeconds;
    this.completionNotified = false;
    this.isResolving = false;
    this.aiThinking = false;
    this.pendingPlayerElement = null;
    this.startTimers();
    this.onUpdate(this.getState());
    return this.getState();
  }

  rematch() {
    return this.startMatch();
  }

  quit({ reason = "quit_forfeit" } = {}) {
    this.cancelPendingAiPacing({ notify: false });
    if (!this.match || this.match.status !== "active") {
      this.stopTimers();
      return this.getState();
    }

    return this.finishMatch({
      winnerId: null,
      loserId: "player",
      result: "player_loss",
      endReason: reason,
      reason
    });
  }

  startTimers() {
    this.stopTimers();
    if (typeof this.scheduler?.setInterval !== "function") {
      return;
    }

    this.timerId = this.scheduler.setInterval(() => {
      if (!this.match || this.match.status !== "active" || this.isResolving) {
        return;
      }
      this.timerSeconds = Math.max(0, this.timerSeconds - 1);
      if (this.timerSeconds <= 0) {
        const legalPlayerCards = this.getLegalPlayableCards("player");
        if (legalPlayerCards.length > 0) {
          this.playPlayerCard({ card: legalPlayerCards[0] });
        }
      } else {
        this.onUpdate(this.getState());
      }
    }, 1000);

    this.matchClockId = this.scheduler.setInterval(() => {
      if (!this.match || this.match.status !== "active") {
        return;
      }
      this.totalMatchSeconds = Math.max(0, this.totalMatchSeconds - 1);
      if (this.totalMatchSeconds <= 0) {
        this.expireByTimeLimit();
      } else {
        this.onUpdate(this.getState());
      }
    }, 1000);
  }

  stopTimers() {
    this.cancelPendingAiPacing({ notify: false });
    if (this.timerId && typeof this.scheduler?.clearInterval === "function") {
      this.scheduler.clearInterval(this.timerId);
    }
    if (this.matchClockId && typeof this.scheduler?.clearInterval === "function") {
      this.scheduler.clearInterval(this.matchClockId);
    }
    this.timerId = null;
    this.matchClockId = null;
  }

  dispose() {
    this.stopTimers();
    this.cancelPendingAiPacing({ notify: false });
  }

  cancelPendingAiPacing({ notify = true } = {}) {
    const pending = this.pendingAiPacingDelay;
    if (!pending) {
      this.aiThinking = false;
      this.pendingPlayerElement = null;
      return;
    }

    this.pendingAiPacingDelay = null;
    if (pending.timeoutId !== null && typeof this.scheduler?.clearTimeout === "function") {
      this.scheduler.clearTimeout(pending.timeoutId);
    }
    this.aiThinking = false;
    this.pendingPlayerElement = null;
    pending.resolve(false);
    if (notify && this.match) {
      this.onUpdate(this.getState());
    }
  }

  getState() {
    if (!this.match) {
      return null;
    }

    return {
      mode: this.match.mode,
      status: this.match.status,
      round: this.match.round,
      combatants: Object.fromEntries(
        BLOOD_MATCH_COMBATANT_IDS.map((id) => [id, cloneCombatant(this.match.combatants[id])])
      ),
      potCardEntries: this.match.potCardEntries.map(cloneCardEntry),
      lastResult: this.match.history.at(-1) ? { ...this.match.history.at(-1) } : null,
      war: {
        active: Boolean(this.match.war.active),
        activeCombatantIds: [...this.match.war.activeCombatantIds],
        clashes: Number(this.match.war.clashes ?? 0)
      },
      legalPlayableCards: Object.fromEntries(
        BLOOD_MATCH_COMBATANT_IDS.map((id) => [id, this.getLegalPlayableCards(id)])
      ),
      terminalResult: this.match.terminalResult ? { ...this.match.terminalResult } : null,
      settlementSummary: this.buildSettlementSummary(),
      winnerId: this.match.winnerId,
      endReason: this.match.endReason,
      timerSeconds: this.timerSeconds,
      totalMatchSeconds: this.totalMatchSeconds,
      aiThinking: Boolean(this.aiThinking),
      pendingPlayerElement: this.pendingPlayerElement
    };
  }

  buildSettlementSummary() {
    if (!this.match) {
      return null;
    }

    return {
      mode: "bloodMatch",
      status: this.match.status,
      round: this.match.round,
      winnerId: this.match.winnerId,
      endReason: this.match.endReason,
      terminalResult: this.match.terminalResult ? { ...this.match.terminalResult } : null,
      combatants: Object.fromEntries(
        BLOOD_MATCH_COMBATANT_IDS.map((id) => {
          const combatant = this.match.combatants[id];
          return [
            id,
            {
              handCount: Math.max(0, Number(combatant?.hand?.length ?? 0) || 0),
              capturedCount: Math.max(0, Number(combatant?.capturedCards?.length ?? 0) || 0),
              eliminated: Boolean(combatant?.eliminated)
            }
          ];
        })
      ),
      history: this.match.history.map(cloneHistorySummary)
    };
  }

  getSurvivingCombatantIds() {
    if (!this.match) {
      return [];
    }
    return BLOOD_MATCH_COMBATANT_IDS.filter((id) => !this.match.combatants[id].eliminated);
  }

  getLegalPlayableCards(combatantId) {
    if (!this.match?.combatants?.[combatantId] || this.match.combatants[combatantId].eliminated) {
      return [];
    }

    const combatant = this.match.combatants[combatantId];
    const blockedElement = getBlockedFatiguedElement(combatant.hand, combatant.recentMoves);
    return combatant.hand.filter((card) => normalizeElement(card) !== blockedElement);
  }

  getAiPacingProfileForCombatants(activeCombatantIds = []) {
    if (!this.match || this.match.status !== "active") {
      return null;
    }

    const aiChoiceCounts = activeCombatantIds
      .filter((id) => id !== "player")
      .map((id) => this.getLegalPlayableCards(id).length);
    if (aiChoiceCounts.length === 0 || aiChoiceCounts.every((count) => count <= 0)) {
      return null;
    }

    return aiChoiceCounts.every((count) => count === 1)
      ? AI_TURN_PACING_PROFILES.FORCED
      : AI_TURN_PACING_PROFILES.HARD;
  }

  waitForAiPacingIfNeeded(profile, { playerElement = null } = {}) {
    if (!profile || typeof this.scheduler?.setTimeout !== "function") {
      return true;
    }

    if (this.pendingAiPacingDelay) {
      return false;
    }

    const generation = this.aiPacingGeneration;
    const delayMs = calculateAiTurnPacingDelayMs(profile, { rng: this.aiPacingRandom });
    const showThinking = profile.key !== "forced";

    if (showThinking) {
      this.aiThinking = true;
      this.pendingPlayerElement = normalizeElement(playerElement);
      this.onUpdate(this.getState());
    }

    return new Promise((resolve) => {
      const pending = {
        generation,
        timeoutId: null,
        resolve: (allowed) => {
          if (this.pendingAiPacingDelay === pending) {
            this.pendingAiPacingDelay = null;
          }
          this.aiThinking = false;
          this.pendingPlayerElement = null;
          resolve(Boolean(allowed));
        }
      };

      pending.timeoutId = this.scheduler.setTimeout(() => {
        const stillCurrent =
          this.pendingAiPacingDelay === pending &&
          this.aiPacingGeneration === generation &&
          this.match?.status === "active" &&
          this.isResolving;
        pending.resolve(stillCurrent);
      }, delayMs);

      this.pendingAiPacingDelay = pending;
    });
  }

  getPlayerCardSelection({ card = null, cardIndex = null } = {}) {
    const legalCards = this.getLegalPlayableCards("player");
    if (legalCards.length === 0) {
      return null;
    }

    if (cardIndex !== null && cardIndex !== undefined) {
      const selected = normalizeElement(this.match.combatants.player.hand[cardIndex]);
      return selected && legalCards.includes(selected) ? selected : null;
    }

    const selectedElement = normalizeElement(card) ?? legalCards[0];
    return legalCards.includes(selectedElement) ? selectedElement : null;
  }

  playPlayerCard({ card = null, cardIndex = null } = {}) {
    if (!this.match || this.match.status !== "active" || this.isResolving) {
      return { status: "ignored", reason: "match-unavailable", state: this.getState() };
    }

    this.isResolving = true;
    const activeCombatantIds = this.match.war.active
      ? this.match.war.activeCombatantIds
      : this.getSurvivingCombatantIds();

    const finishWithoutResolution = (result) => {
      this.isResolving = false;
      return result;
    };

    const requiredPlayResult = this.evaluateRequiredPlay(activeCombatantIds);
    if (requiredPlayResult.terminal || requiredPlayResult.type !== "continue") {
      return finishWithoutResolution({
        status: "required_play_result",
        result: requiredPlayResult,
        state: this.getState()
      });
    }

    const playerElement = activeCombatantIds.includes("player")
      ? this.getPlayerCardSelection({ card, cardIndex })
      : null;
    if (activeCombatantIds.includes("player") && !playerElement) {
      return finishWithoutResolution({
        status: "ignored",
        reason: "player-card-unavailable",
        state: this.getState()
      });
    }

    const pacingProfile = this.getAiPacingProfileForCombatants(activeCombatantIds);
    const continueReveal = () => this.resolvePlayerCardAfterPacing({ card, cardIndex, activeCombatantIds });
    const pacingWait = this.waitForAiPacingIfNeeded(pacingProfile, { playerElement });
    if (typeof pacingWait?.then === "function") {
      return pacingWait.then((pacingReady) => {
        if (!pacingReady) {
          this.isResolving = false;
          return { status: "ignored", reason: "ai-pacing-cancelled", state: this.getState() };
        }
        return continueReveal();
      });
    }

    return continueReveal();
  }

  resolvePlayerCardAfterPacing({ card = null, cardIndex = null, activeCombatantIds = [] } = {}) {
    try {
      const revealEntries = [];
      if (activeCombatantIds.includes("player")) {
        const playerCard = this.takePlayerCard({ card, cardIndex });
        if (!playerCard) {
          return { status: "ignored", reason: "player-card-unavailable", state: this.getState() };
        }
        revealEntries.push({ ownerId: "player", element: playerCard });
      }

      for (const combatantId of activeCombatantIds.filter((id) => id !== "player")) {
        const aiCard = this.takeAiCard(combatantId);
        if (!aiCard) {
          const retryRequiredPlay = this.evaluateRequiredPlay(activeCombatantIds);
          return { status: "required_play_result", result: retryRequiredPlay, state: this.getState() };
        }
        revealEntries.push({ ownerId: combatantId, element: aiCard });
      }

      for (const entry of revealEntries) {
        this.match.combatants[entry.ownerId].recentMoves.push(entry.element);
      }

      const result = this.match.war.active
        ? this.resolveWarReveal(revealEntries)
        : this.resolveNormalReveal(revealEntries);
      const immediateRequiredPlayResult = this.resolveImmediateRequiredPlayIfNeeded();

      if (this.match.status === "active") {
        this.timerSeconds = this.timerDefault;
      }
      this.onRoundResolved(result);
      this.onUpdate(this.getState());
      return {
        status: "resolved",
        result,
        requiredPlayResult: immediateRequiredPlayResult,
        state: this.getState()
      };
    } finally {
      this.isResolving = false;
    }
  }

  takePlayerCard({ card = null, cardIndex = null } = {}) {
    const legalCards = this.getLegalPlayableCards("player");
    if (legalCards.length === 0) {
      return null;
    }

    if (cardIndex !== null && cardIndex !== undefined) {
      const selected = this.match.combatants.player.hand[cardIndex];
      if (!legalCards.includes(selected)) {
        return null;
      }
      return normalizeElement(removeCardAt(this.match.combatants.player.hand, cardIndex));
    }

    const selectedElement = normalizeElement(card) ?? legalCards[0];
    if (!legalCards.includes(selectedElement)) {
      return null;
    }
    return normalizeElement(removeFirstMatchingCard(this.match.combatants.player.hand, selectedElement));
  }

  takeAiCard(combatantId) {
    const legalHand = this.getLegalPlayableCards(combatantId);
    if (legalHand.length === 0) {
      return null;
    }

    const combatant = this.match.combatants[combatantId];
    const injectedChoice = this.aiChooser?.({
      combatantId,
      legalHand: [...legalHand],
      hand: [...combatant.hand],
      state: this.getState()
    });
    const injectedElement = normalizeElement(injectedChoice);
    const selectedElement = injectedElement && legalHand.includes(injectedElement)
      ? injectedElement
      : legalHand[
          chooseGauntletRivalCardIndex(legalHand, {
            rivalId: combatant.rivalId,
            turnIndex: Math.max(0, Number(this.match.round ?? 1) - 1),
            playerPreviousElement: this.match.combatants.player.recentMoves.at(-1) ?? null,
            publicState: this.buildAiPublicState(combatantId),
            rng: this.rng
          }) ?? 0
        ];

    return normalizeElement(removeFirstMatchingCard(combatant.hand, selectedElement));
  }

  buildAiPublicState(combatantId) {
    const combatant = this.match.combatants[combatantId];
    const player = this.match.combatants.player;
    return {
      aiCardsRemaining: combatant.hand.length,
      playerCardsRemaining: player.hand.length,
      aiCaptured: combatant.capturedCards.length,
      playerCaptured: player.capturedCards.length,
      warActive: Boolean(this.match.war.active),
      pileCount: this.match.potCardEntries.length,
      totalWarClashes: Number(this.match.war.clashes ?? 0),
      playerElementCounts: buildElementCounts(player.hand),
      recentPlayerMoves: [...player.recentMoves]
    };
  }

  resolveNormalReveal(revealEntries) {
    if (revealEntries.length === 2) {
      return this.resolveTwoCombatantReveal(revealEntries);
    }

    const revealByCombatant = Object.fromEntries(revealEntries.map((entry) => [entry.ownerId, entry.element]));
    const classification = classifyBloodMatchReveal(revealByCombatant);

    if (classification.type === BLOOD_MATCH_REVEAL_TYPES.CLEAR_WINNER) {
      this.awardPotToWinner(classification.winnerId, classification.potCardEntries);
      this.match.war = { active: false, activeCombatantIds: [], clashes: 0 };
    } else {
      this.match.potCardEntries = appendBloodMatchPotEntries(
        this.match.potCardEntries,
        classification.potCardEntries
      );
      for (const entry of classification.returnedCardEntries) {
        this.match.combatants[entry.ownerId].hand.push(entry.element);
      }
      this.match.war = {
        active: true,
        activeCombatantIds: sortCombatantIds(classification.activeCombatantIds),
        clashes: this.match.war.clashes
      };
    }

    this.match.history.push(classification);
    this.match.round += 1;
    return classification;
  }

  resolveTwoCombatantReveal(revealEntries) {
    const sortedEntries = sortCombatantIds(revealEntries.map((entry) => entry.ownerId))
      .map((id) => revealEntries.find((entry) => entry.ownerId === id))
      .filter(Boolean);
    const winnerId = compareTwoCombatantEntries(sortedEntries[0], sortedEntries[1]);
    const isTie = sortedEntries[0]?.element === sortedEntries[1]?.element;
    const result = {
      type: winnerId ? "clear_winner" : isTie ? "two_way_war" : "two_combatant_no_effect",
      activeCombatantIds: isTie ? sortedEntries.map((entry) => entry.ownerId) : [],
      excludedCombatantIds: BLOOD_MATCH_COMBATANT_IDS.filter(
        (id) => !sortedEntries.some((entry) => entry.ownerId === id)
      ),
      winnerId,
      potCardEntries: winnerId || isTie ? sortedEntries.map(cloneCardEntry) : [],
      returnedCardEntries: winnerId || isTie ? [] : sortedEntries.map(cloneCardEntry),
      revealedCardEntries: sortedEntries.map(cloneCardEntry),
      classificationId: winnerId
        ? "two_combatant_clear_winner"
        : isTie
          ? "two_combatant_war"
          : "two_combatant_no_effect",
      reason: winnerId
        ? "two_combatant_clear_winner"
        : isTie
          ? "two_combatant_war"
          : "two_combatant_no_effect"
    };

    if (winnerId) {
      this.awardPotToWinner(winnerId, result.potCardEntries);
      this.match.war = { active: false, activeCombatantIds: [], clashes: this.match.war.clashes };
    } else if (isTie) {
      this.match.potCardEntries = appendBloodMatchPotEntries(this.match.potCardEntries, result.potCardEntries);
      this.match.war = {
        active: true,
        activeCombatantIds: sortedEntries.map((entry) => entry.ownerId),
        clashes: this.match.war.clashes
      };
    } else {
      for (const entry of result.returnedCardEntries) {
        this.match.combatants[entry.ownerId].hand.push(entry.element);
      }
      this.match.war = { active: false, activeCombatantIds: [], clashes: this.match.war.clashes };
    }

    this.match.history.push(result);
    this.match.round += 1;
    return result;
  }

  resolveWarReveal(revealEntries) {
    const sortedEntries = sortCombatantIds(revealEntries.map((entry) => entry.ownerId))
      .map((id) => revealEntries.find((entry) => entry.ownerId === id))
      .filter(Boolean);

    this.match.potCardEntries = appendBloodMatchPotEntries(this.match.potCardEntries, sortedEntries);
    this.match.war.clashes += 1;

    if (sortedEntries.length === 3) {
      const classification = classifyBloodMatchReveal(sortedEntries);
      if (classification.type === BLOOD_MATCH_REVEAL_TYPES.CLEAR_WINNER) {
        this.awardPotToWinner(classification.winnerId, []);
        this.match.war = { active: false, activeCombatantIds: [], clashes: this.match.war.clashes };
      } else {
        for (const entry of classification.returnedCardEntries) {
          const potIndex = this.match.potCardEntries.findIndex(
            (potEntry) => potEntry.ownerId === entry.ownerId && potEntry.element === entry.element
          );
          if (potIndex >= 0) {
            this.match.potCardEntries.splice(potIndex, 1);
          }
          this.match.combatants[entry.ownerId].hand.push(entry.element);
        }
        this.match.war.activeCombatantIds = sortCombatantIds(classification.activeCombatantIds);
      }
      this.match.history.push(classification);
      this.match.round += 1;
      return classification;
    }

    if (sortedEntries.length === 2) {
      const winnerId = compareTwoCombatantEntries(sortedEntries[0], sortedEntries[1]);
      const result = {
        type: winnerId ? "war_resolved" : "war_continues",
        activeCombatantIds: winnerId ? [] : sortedEntries.map((entry) => entry.ownerId),
        excludedCombatantIds: BLOOD_MATCH_COMBATANT_IDS.filter(
          (id) => !sortedEntries.some((entry) => entry.ownerId === id)
        ),
        winnerId,
        potCardEntries: sortedEntries.map(cloneCardEntry),
        returnedCardEntries: [],
        revealedCardEntries: sortedEntries.map(cloneCardEntry),
        classificationId: winnerId ? "two_combatant_war_resolved" : "two_combatant_war_tie",
        reason: winnerId ? "two_combatant_war_resolved" : "two_combatant_war_tie"
      };

      if (winnerId) {
        this.awardPotToWinner(winnerId, []);
        this.match.war = { active: false, activeCombatantIds: [], clashes: this.match.war.clashes };
      } else {
        this.match.war.activeCombatantIds = sortedEntries.map((entry) => entry.ownerId);
      }

      this.match.history.push(result);
      this.match.round += 1;
      return result;
    }

    throw new Error("Blood Match WAR requires at least two active combatants.");
  }

  awardPotToWinner(winnerId, additionalEntries = []) {
    const winner = this.match.combatants[winnerId];
    if (!winner) {
      return;
    }
    const awardEntries = appendBloodMatchPotEntries(this.match.potCardEntries, additionalEntries);
    winner.hand.push(...awardEntries.map((entry) => entry.element));
    winner.capturedCards.push(...awardEntries);
    this.match.potCardEntries = [];
  }

  resolveImmediateRequiredPlayIfNeeded() {
    if (!this.match || this.match.status !== "active") {
      return null;
    }

    const activeCombatantIds = this.match.war.active
      ? this.match.war.activeCombatantIds
      : this.getSurvivingCombatantIds();
    const result = this.evaluateRequiredPlay(activeCombatantIds);
    return result.type === "continue" ? null : result;
  }

  evaluateRequiredPlay(activeCombatantIds = this.getSurvivingCombatantIds()) {
    const legalPlayableCardCounts = Object.fromEntries(
      BLOOD_MATCH_COMBATANT_IDS.map((id) => [
        id,
        activeCombatantIds.includes(id) ? this.getLegalPlayableCards(id).length : WAR_REQUIRED_CARDS
      ])
    );
    const result = evaluateBloodMatchRequiredPlayAvailability({
      legalPlayableCardCounts,
      activeCombatantIds
    });

    if (result.type === "player_loss") {
      this.match.combatants.player.eliminated = true;
      this.finishMatch({
        ...result,
        result: "player_loss",
        endReason: result.reason
      });
      return result;
    }

    for (const combatantId of result.eliminatedCombatantIds ?? []) {
      if (this.match.combatants[combatantId]) {
        this.match.combatants[combatantId].eliminated = true;
      }
    }

    if (result.type === "player_win") {
      const survivingCombatantIds = this.getSurvivingCombatantIds();
      const bothRivalsEliminated = ["vampire", "lycan"].every((id) => this.match.combatants[id]?.eliminated);
      if (bothRivalsEliminated) {
        this.finishMatch({
          ...result,
          result: "player_win",
          endReason: result.reason
        });
        return result;
      }

      const continuationResult = {
        ...result,
        type: "ai_eliminated_continue",
        terminal: false,
        winnerId: null,
        remainingCombatantIds: survivingCombatantIds,
        reason: "ai_required_play_unavailable"
      };
      this.updateWarAfterAiElimination(continuationResult);
      return continuationResult;
    }

    if (result.type === "ai_eliminated_continue") {
      this.updateWarAfterAiElimination(result);
    }

    return result;
  }

  updateWarAfterAiElimination(result = {}) {
    const survivingCombatantIds = this.getSurvivingCombatantIds();
    const remainingCombatantIds = sortCombatantIds(
      [
        ...survivingCombatantIds,
        ...(Array.isArray(result.remainingCombatantIds) ? result.remainingCombatantIds : [])
      ].filter((id) => id === "player" || !this.match.combatants[id]?.eliminated)
    );
    const hasActivePot = Array.isArray(this.match.potCardEntries) && this.match.potCardEntries.length > 0;
    const hadActiveWar = Boolean(this.match.war.active);
    this.match.war.activeCombatantIds = remainingCombatantIds;
    this.match.war.active = (hadActiveWar || hasActivePot) && remainingCombatantIds.length >= 2;
    if (!this.match.war.active) {
      this.match.war.activeCombatantIds = [];
    }
  }

  expireByTimeLimit() {
    if (!this.match || this.match.status !== "active") {
      return this.getState()?.terminalResult ?? null;
    }

    this.totalMatchSeconds = 0;
    const timeoutResult = resolveBloodMatchTimeout({
      playerHandCount: this.match.combatants.player.hand.length,
      vampireHandCount: this.match.combatants.vampire.hand.length,
      lycanHandCount: this.match.combatants.lycan.hand.length,
      vampireEliminated: this.match.combatants.vampire.eliminated,
      lycanEliminated: this.match.combatants.lycan.eliminated
    });
    this.finishMatch(timeoutResult);
    return this.getState().terminalResult;
  }

  finishMatch(result = {}) {
    if (!this.match || this.match.status === "completed") {
      return this.getState();
    }

    this.stopTimers();
    this.match.status = "completed";
    this.match.winnerId = result.winnerId ?? null;
    this.match.endReason = result.endReason ?? result.reason ?? null;
    this.match.terminalResult = {
      terminal: true,
      winnerId: result.winnerId ?? null,
      loserId: result.loserId ?? null,
      result: result.result ?? (result.winnerId === "player" ? "player_win" : "player_loss"),
      endReason: this.match.endReason,
      reason: result.reason ?? this.match.endReason
    };

    if (!this.completionNotified) {
      this.completionNotified = true;
      this.onMatchComplete(this.match.terminalResult, this.getState());
    }
    this.onUpdate(this.getState());
    return this.getState();
  }
}

export function createBloodMatchController(options = {}) {
  return new BloodMatchController(options);
}
