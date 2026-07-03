import {
  AI_DIFFICULTY,
  WAR_REQUIRED_CARDS,
  chooseAiCardIndex,
  chooseGauntletRivalCardIndex,
  completeMatch,
  completeMatchByCardCount,
  createMatch,
  elementThatBeats,
  getMatchSummary,
  playRoundManualWarStep
} from "../../engine/index.js";
import { createRoomStore } from "../../multiplayer/rooms.js";
import { deriveMatchStats } from "../../state/statsTracking.js";
import { getGauntletRivalById } from "../../engine/gauntletRivals.js";
import { evaluateTrainingCoach } from "./trainingCoachEvaluator.js";

const MATCH_MODE = Object.freeze({
  PVE: "pve",
  LOCAL_PVP: "local_pvp"
});
const LOCAL_AUTHORITY_ELEMENT_ORDER = Object.freeze(["fire", "water", "earth", "wind"]);
const TRAINING_OPPONENT_PERSONALITIES = Object.freeze({
  REPEATER: "repeater",
  COUNTERER: "counterer",
  SURVIVOR: "survivor"
});
const FATIGUE_TOOLTIP = "This Elemint must rest for 1 turn.";

function normalizeElementMove(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return LOCAL_AUTHORITY_ELEMENT_ORDER.includes(normalized) ? normalized : null;
}

function buildElementCountsFromCards(cards = []) {
  const counts = {
    fire: 0,
    water: 0,
    earth: 0,
    wind: 0
  };

  for (const card of Array.isArray(cards) ? cards : []) {
    const element = String(card ?? "").trim().toLowerCase();
    if (Object.hasOwn(counts, element)) {
      counts[element] += 1;
    }
  }

  return counts;
}

function getRecentHistoryMoves(history = [], key) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry) => normalizeElementMove(entry?.[key]))
    .filter(Boolean)
    .slice(-6);
}

function deriveFatiguedElementFromRecentMoves(recentMoves = []) {
  const normalizedMoves = Array.isArray(recentMoves)
    ? recentMoves.map((move) => normalizeElementMove(move)).filter(Boolean)
    : [];
  const lastMove = normalizedMoves.at(-1) ?? null;
  const priorMove = normalizedMoves.at(-2) ?? null;

  return lastMove && lastMove === priorMove ? lastMove : null;
}

function getBlockedFatiguedElementForCounts(elementCounts = {}, recentMoves = []) {
  const fatiguedElement = deriveFatiguedElementFromRecentMoves(recentMoves);
  if (!fatiguedElement) {
    return null;
  }

  const fatiguedCount = Math.max(0, Number(elementCounts?.[fatiguedElement] ?? 0));
  if (fatiguedCount <= 0) {
    return null;
  }

  const hasAlternative = LOCAL_AUTHORITY_ELEMENT_ORDER.some(
    (element) => element !== fatiguedElement && Math.max(0, Number(elementCounts?.[element] ?? 0)) > 0
  );

  return hasAlternative ? fatiguedElement : null;
}

function normalizeTrainingOpponentPersonality(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Object.values(TRAINING_OPPONENT_PERSONALITIES).includes(normalized)
    ? normalized
    : TRAINING_OPPONENT_PERSONALITIES.REPEATER;
}

function buildLegalCardOptions(hand = [], blockedElement = null) {
  return (Array.isArray(hand) ? hand : [])
    .map((card, index) => ({ card: normalizeElementMove(card), index }))
    .filter(({ card }) => card && card !== blockedElement);
}

function chooseFirstLegalOptionByElement(legalOptions = [], element) {
  const normalizedElement = normalizeElementMove(element);
  if (!normalizedElement) {
    return null;
  }

  return legalOptions.find((option) => option.card === normalizedElement) ?? null;
}

function chooseTrainingOpponentCardIndex({
  personality = TRAINING_OPPONENT_PERSONALITIES.REPEATER,
  legalOptions = [],
  recentPlayerMoves = [],
  recentOpponentMoves = [],
  publicState = {}
} = {}) {
  if (!Array.isArray(legalOptions) || legalOptions.length === 0) {
    return null;
  }

  const normalizedPersonality = normalizeTrainingOpponentPersonality(personality);
  const lastOpponentMove = normalizeElementMove(recentOpponentMoves.at(-1));
  const lastPlayerMove = normalizeElementMove(recentPlayerMoves.at(-1));

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.REPEATER) {
    const repeatedOption = chooseFirstLegalOptionByElement(legalOptions, lastOpponentMove);
    if (repeatedOption) {
      return repeatedOption.index;
    }
  }

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.COUNTERER && lastPlayerMove) {
    const counterOption = chooseFirstLegalOptionByElement(legalOptions, elementThatBeats(lastPlayerMove));
    if (counterOption) {
      return counterOption.index;
    }
  }

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.SURVIVOR) {
    const warPressure =
      Boolean(publicState?.warActive) ||
      Number(publicState?.aiCardsRemaining ?? legalOptions.length) <= WAR_REQUIRED_CARDS ||
      Number(publicState?.playerCardsRemaining ?? 0) <= WAR_REQUIRED_CARDS;
    if (warPressure && lastPlayerMove) {
      const lowerTieRiskOption = legalOptions.find((option) => option.card !== lastPlayerMove);
      if (lowerTieRiskOption) {
        return lowerTieRiskOption.index;
      }
    }
  }

  return legalOptions[0]?.index ?? null;
}

function createLocalAuthoritySocket(label) {
  return {
    id: `local-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  };
}

function expandAuthoritativeHand(handState) {
  const cards = [];

  for (const element of LOCAL_AUTHORITY_ELEMENT_ORDER) {
    const count = Math.max(0, Number(handState?.[element] ?? 0));
    for (let index = 0; index < count; index += 1) {
      cards.push(element);
    }
  }

  return cards;
}

function interleaveWarPotCards(warPot) {
  const hostCards = Array.isArray(warPot?.host) ? warPot.host : [];
  const guestCards = Array.isArray(warPot?.guest) ? warPot.guest : [];
  const pile = [];
  const maxLength = Math.max(hostCards.length, guestCards.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (index < hostCards.length) {
      pile.push(hostCards[index]);
    }
    if (index < guestCards.length) {
      pile.push(guestCards[index]);
    }
  }

  return pile;
}

function resolveLocalWinnerFromRoomWinner(winner) {
  if (winner === "host") {
    return "p1";
  }

  if (winner === "guest") {
    return "p2";
  }

  return winner === "draw" ? "draw" : null;
}

function resolveLocalRoundResult(entry, roomWinner = null) {
  if (entry?.hostResult === "win") {
    return "p1";
  }

  if (entry?.guestResult === "win") {
    return "p2";
  }

  if (roomWinner === "host") {
    return "p1";
  }

  if (roomWinner === "guest") {
    return "p2";
  }

  return roomWinner === "draw" ? "draw" : "none";
}

function getStoredCapturedOpponentCards(entry, fallback = 0) {
  const explicit = Number(entry?.capturedOpponentCards);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return Math.max(0, Number(fallback) || 0);
}

function getStoredCapturedCards(entry, fallback = 0) {
  const explicit = Number(entry?.capturedCards);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return Math.max(0, Number(fallback) || 0);
}

function countWarResolutionClashes(roundHistory, resolvedIndex) {
  const priorChainOutcomes = [];

  for (let cursor = resolvedIndex - 1; cursor >= 0; cursor -= 1) {
    const priorOutcomeType = String(roundHistory[cursor]?.outcomeType ?? "");

    if (priorOutcomeType === "war" || priorOutcomeType === "no_effect") {
      priorChainOutcomes.unshift(priorOutcomeType);
      continue;
    }

    break;
  }

  while (priorChainOutcomes[0] === "no_effect") {
    priorChainOutcomes.shift();
  }

  return 1 + priorChainOutcomes.length;
}

function resolveTerminalWarClashes(entry) {
  const explicitDepth = Number(entry?.warDepth);
  if (Number.isFinite(explicitDepth) && explicitDepth > 0) {
    return Math.max(1, Math.floor(explicitDepth));
  }

  const roundCount = Array.isArray(entry?.warRounds) ? entry.warRounds.length : 0;
  if (roundCount > 0) {
    return Math.max(1, roundCount);
  }

  return 1;
}

function hasTerminalWarMetadata(entry) {
  const explicitDepth = Number(entry?.warDepth);
  if (Number.isFinite(explicitDepth) && explicitDepth > 0) {
    return true;
  }

  return Array.isArray(entry?.warRounds) && entry.warRounds.length > 0;
}

function buildLocalHistoryFromRoundHistory(roundHistory = [], roomWinner = null, matchComplete = false) {
  const history = [];

  for (let index = 0; index < roundHistory.length; index += 1) {
    const entry = roundHistory[index];
    const outcomeType = String(entry?.outcomeType ?? "");
    const isTerminalCompletedWar =
      matchComplete &&
      index === roundHistory.length - 1 &&
      (
        outcomeType === "war" ||
        (outcomeType === "no_effect" && hasTerminalWarMetadata(entry))
      );

    if (outcomeType === "war" || isTerminalCompletedWar) {
      history.push({
        result: isTerminalCompletedWar ? resolveLocalRoundResult(entry, roomWinner) : "none",
        warClashes: isTerminalCompletedWar ? resolveTerminalWarClashes(entry) : 0,
        capturedCards: 0,
        capturedOpponentCards: 0,
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    if (outcomeType === "war_resolved") {
      const warClashes = countWarResolutionClashes(roundHistory, index);
      history.push({
        result: resolveLocalRoundResult(entry, roomWinner),
        warClashes,
        capturedCards: getStoredCapturedCards(entry, 0),
        capturedOpponentCards: getStoredCapturedOpponentCards(entry, 0),
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    if (outcomeType === "resolved") {
      history.push({
        result: resolveLocalRoundResult(entry, roomWinner),
        warClashes: 0,
        capturedCards: getStoredCapturedCards(
          entry,
          entry?.hostResult === "win" || entry?.guestResult === "win" ? 2 : 0
        ),
        capturedOpponentCards: getStoredCapturedOpponentCards(
          entry,
          entry?.hostResult === "win" || entry?.guestResult === "win" ? 1 : 0
        ),
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    history.push({
      result: "none",
      warClashes: 0,
      capturedCards: 0,
      capturedOpponentCards: 0,
      p1Card: String(entry?.hostMove ?? "").toLowerCase(),
      p2Card: String(entry?.guestMove ?? "").toLowerCase()
    });
  }

  return history;
}

function buildAuthoritativeLocalRoundKey(entry) {
  return [
    Number(entry?.round ?? 0),
    String(entry?.outcomeType ?? ""),
    String(entry?.hostResult ?? ""),
    String(entry?.guestResult ?? ""),
    String(entry?.hostMove ?? ""),
    String(entry?.guestMove ?? ""),
    Number(entry?.capturedCards ?? 0),
    Number(entry?.capturedOpponentCards ?? 0)
  ].join("|");
}

function mergeAuthoritativeLocalPveRoundHistory(existingRoundHistory = [], incomingRoundHistory = []) {
  if (!Array.isArray(existingRoundHistory) || existingRoundHistory.length === 0) {
    return Array.isArray(incomingRoundHistory) ? incomingRoundHistory.map((entry) => ({ ...entry })) : [];
  }

  if (!Array.isArray(incomingRoundHistory) || incomingRoundHistory.length === 0) {
    return existingRoundHistory.map((entry) => ({ ...entry }));
  }

  const merged = existingRoundHistory.map((entry) => ({ ...entry }));
  const seen = new Set(merged.map(buildAuthoritativeLocalRoundKey));

  for (const entry of incomingRoundHistory) {
    const key = buildAuthoritativeLocalRoundKey(entry);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({ ...entry });
  }

  return merged;
}

function countWonRounds(history, perspective) {
  return history.reduce((total, round) => total + (round?.result === perspective ? 1 : 0), 0);
}

function buildLocalRoundFromAuthoritativeResult(roundResult, room) {
  if (!roundResult) {
    return null;
  }

  const warRounds = Array.isArray(roundResult.warRounds) ? roundResult.warRounds : [];
  const warClashes =
    roundResult.outcomeType === "war_resolved"
      ? Math.max(1, warRounds.length || 1)
      : roundResult.outcomeType === "war" && room?.matchComplete
        ? Math.max(1, warRounds.length || 1)
        : 0;
  const result = resolveLocalRoundResult(roundResult, room?.winner ?? null);
  const capturedOpponentCards =
    result === "p1" || result === "p2"
      ? warClashes > 0
        ? getStoredCapturedOpponentCards(roundResult, warClashes)
        : getStoredCapturedOpponentCards(
            roundResult,
            roundResult.hostResult === "win" || roundResult.guestResult === "win" ? 1 : 0
          )
      : 0;
  const capturedCards =
    result === "p1" || result === "p2"
      ? warClashes > 0
        ? getStoredCapturedCards(roundResult, capturedOpponentCards * 2)
        : getStoredCapturedCards(
            roundResult,
            roundResult.hostResult === "win" || roundResult.guestResult === "win" ? 2 : 0
          )
      : getStoredCapturedCards(roundResult, 0);

  return {
    round: Number(roundResult.round ?? 0),
    p1Card: String(roundResult.hostMove ?? "").toLowerCase() || null,
    p2Card: String(roundResult.guestMove ?? "").toLowerCase() || null,
    result,
    warClashes,
    warPileSize: Array.isArray(roundResult.warPot?.host) || Array.isArray(roundResult.warPot?.guest)
      ? (Array.isArray(roundResult.warPot?.host) ? roundResult.warPot.host.length : 0) +
        (Array.isArray(roundResult.warPot?.guest) ? roundResult.warPot.guest.length : 0)
      : 0,
    warPileSizes: warClashes > 0
      ? warRounds.map((_, index) => (index + 1) * 2)
      : [],
    warEntryPileSize: warClashes > 0 ? 2 : 0,
    capturedCards,
    capturedOpponentCards
  };
}

function buildLocalMatchFromAuthoritativeRoom(
  room,
  existingMatch = null,
  mode = MATCH_MODE.LOCAL_PVP,
  aiDifficulty = AI_DIFFICULTY.NORMAL
) {
  const matchId =
    room?.serverMatchState?.matchId ??
    room?.roomCode ??
    existingMatch?.id ??
    (mode === MATCH_MODE.PVE ? "local-pve-authoritative" : "local-pvp-authoritative");
  const history = buildLocalHistoryFromRoundHistory(
    room?.roundHistory ?? [],
    room?.winner ?? null,
    Boolean(room?.matchComplete)
  );
  const p1Hand = expandAuthoritativeHand(room?.hostHand);
  const p2Hand = expandAuthoritativeHand(room?.guestHand);
  const currentPile = room?.warActive ? interleaveWarPotCards(room?.warPot) : [];
  const pendingWarSizes =
    room?.warActive && Array.isArray(room?.warRounds)
      ? room.warRounds.map((_, index) => (index + 1) * 2)
      : [];
  const authoritativeTotalWarClashes = Number(room?.totalWarClashes);
  const totalWarClashes =
    Number.isFinite(authoritativeTotalWarClashes) && authoritativeTotalWarClashes >= 0
      ? Math.floor(authoritativeTotalWarClashes)
      : history.reduce(
          (total, entry) => total + Math.max(0, Number(entry?.warClashes ?? 0) || 0),
          0
        );

  return {
    id: matchId,
    status: room?.matchComplete ? "completed" : "active",
    round: Math.max(0, Number(room?.roundNumber ?? 1) - 1),
    mode,
    featuredRivalId: String(room?.featuredRivalId ?? "").trim().toLowerCase() || null,
    gauntletRivalId: String(room?.gauntletRivalId ?? "").trim().toLowerCase() || null,
    difficulty:
      existingMatch?.difficulty ??
      (mode === MATCH_MODE.PVE ? aiDifficulty : "authoritative_local_pvp"),
    winner: room?.matchComplete ? resolveLocalWinnerFromRoomWinner(room?.winner) : null,
    endReason: room?.matchComplete ? room?.winReason ?? null : null,
    currentPile,
    players: {
      p1: { hand: p1Hand, wonRounds: countWonRounds(history, "p1") },
      p2: { hand: p2Hand, wonRounds: countWonRounds(history, "p2") }
    },
    war: {
      active: Boolean(room?.warActive),
      clashes: totalWarClashes,
      pendingClashes: pendingWarSizes.length,
      pendingPileSizes: pendingWarSizes
    },
    history,
    meta: {
      totalCards:
        existingMatch?.meta?.totalCards ??
        (String(room?.featuredRivalId ?? "").trim().toLowerCase() === "crownfire_duelist" ? 20 : 16),
      startedAt: existingMatch?.meta?.startedAt ?? null,
      endedAt: existingMatch?.meta?.endedAt ?? null,
      durationMs: existingMatch?.meta?.durationMs ?? 0
    }
  };
}

function difficultyFromSettings(value) {
  const allowed = new Set(Object.values(AI_DIFFICULTY));
  return allowed.has(value) ? value : AI_DIFFICULTY.NORMAL;
}

function formatRoundResult(round) {
  if (!round) return "No round played yet.";

  const capturedOpponentCards = getWinnerCapturedOpponentCards(round);

  if (round.result === "none") {
    return "No effect. Both players keep their own card.";
  }

  if (round.warClashes > 0) {
    if (round.result === "p1") {
      return `WAR resolved. You captured ${capturedOpponentCards} opponent card(s).`;
    }

    if (round.result === "p2") {
      return capturedOpponentCards > 0
        ? `WAR resolved. Opponent captured ${capturedOpponentCards} of your card(s).`
        : "WAR resolved. Opponent won the WAR pot.";
    }
  }

  if (round.result === "p1") {
    return `You captured ${capturedOpponentCards} opponent card(s).`;
  }

  if (round.result === "p2") {
    return capturedOpponentCards > 0
      ? `Opponent captured ${capturedOpponentCards} of your card(s).`
      : "Opponent won the round.";
  }

  return "Round ended in a draw.";
}

function classifyRoundOutcome(round, warActive = false) {
  if (!round) {
    return {
      key: "no_effect",
      label: "No effect"
    };
  }

  if (warActive) {
    return {
      key: "war_triggered",
      label: "WAR triggered"
    };
  }

  if (round.result === "p1") {
    return {
      key: "player_win",
      label: "Player wins"
    };
  }

  if (round.result === "p2") {
    return {
      key: "opponent_win",
      label: "Opponent wins"
    };
  }

  return {
    key: "no_effect",
    label: "No effect"
  };
}

function safeCardIndex(hand, index) {
  if (!Array.isArray(hand) || hand.length === 0) {
    return null;
  }

  const numeric = Number(index);
  if (!Number.isInteger(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(numeric, hand.length - 1));
}

function getCardAtIndex(hand, index) {
  const resolved = safeCardIndex(hand, index);
  if (resolved === null) {
    return null;
  }

  return hand[resolved] ?? null;
}

function getOpponentCardsCaptured(round) {
  const explicit = Number(round?.capturedOpponentCards);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return Math.max(0, Math.floor(Number(round?.capturedCards ?? 0) / 2));
}

function getWinnerCapturedOpponentCards(round) {
  const explicit = getOpponentCardsCaptured(round);
  const totalCaptured = Math.max(0, Math.floor(Number(round?.capturedCards ?? 0) / 2));

  // `capturedOpponentCards` is local-player-perspective data in some paths, so an opponent win
  // can legitimately arrive with `0` even when the winner took cards from the WAR pot.
  if (round?.result === "p2" && totalCaptured > 0) {
    return totalCaptured;
  }

  return explicit > 0 ? explicit : totalCaptured;
}

function hasRequiredWarCards(hand) {
  return Array.isArray(hand) && hand.length >= WAR_REQUIRED_CARDS;
}

function formatPveTraceValue(value) {
  return value == null || value === "" ? "-" : String(value);
}

function logLocalPveTrace(room, rebuiltMatch, viewModel) {
  const rawRow = Array.isArray(room?.roundHistory) && room.roundHistory.length > 0
    ? room.roundHistory.at(-1)
    : null;
  const rebuiltRow = Array.isArray(rebuiltMatch?.history) && rebuiltMatch.history.length > 0
    ? rebuiltMatch.history.at(-1)
    : null;
  const p1Stats = deriveMatchStats(rebuiltMatch, "p1");
  const p2Stats = deriveMatchStats(rebuiltMatch, "p2");

  console.log(
    `[TRACE][PVE][RAW] round=${formatPveTraceValue(rawRow?.round ?? room?.roundNumber)} ` +
      `outcome=${formatPveTraceValue(rawRow?.outcomeType)} ` +
      `hostResult=${formatPveTraceValue(rawRow?.hostResult)} ` +
      `guestResult=${formatPveTraceValue(rawRow?.guestResult)} ` +
      `hostMove=${formatPveTraceValue(rawRow?.hostMove)} ` +
      `guestMove=${formatPveTraceValue(rawRow?.guestMove)} ` +
      `capturedCards=${formatPveTraceValue(rawRow?.capturedCards)} ` +
      `capturedOpponentCards=${formatPveTraceValue(rawRow?.capturedOpponentCards)} ` +
      `warActive=${Boolean(room?.warActive)} ` +
      `warDepth=${formatPveTraceValue(room?.warDepth)}`
  );
  console.log(
    `[TRACE][PVE][REBUILT] result=${formatPveTraceValue(rebuiltRow?.result)} ` +
      `warClashes=${formatPveTraceValue(rebuiltRow?.warClashes)} ` +
      `p1Card=${formatPveTraceValue(rebuiltRow?.p1Card)} ` +
      `p2Card=${formatPveTraceValue(rebuiltRow?.p2Card)} ` +
      `capturedCards=${formatPveTraceValue(rebuiltRow?.capturedCards)} ` +
      `capturedOpponentCards=${formatPveTraceValue(rebuiltRow?.capturedOpponentCards)}`
  );
  console.log(
    `[TRACE][PVE][DERIVED] p1Captured=${formatPveTraceValue(p1Stats?.cardsCaptured)} ` +
      `p2Captured=${formatPveTraceValue(p2Stats?.cardsCaptured)} ` +
      `p1WarsEntered=${formatPveTraceValue(p1Stats?.warsEntered)} ` +
      `p2WarsEntered=${formatPveTraceValue(p2Stats?.warsEntered)} ` +
      `p1LongestWar=${formatPveTraceValue(p1Stats?.longestWar)} ` +
      `p2LongestWar=${formatPveTraceValue(p2Stats?.longestWar)}`
  );
  console.log(
    `[TRACE][PVE][HUD] p1=${formatPveTraceValue(viewModel?.captured?.p1)} ` +
      `p2=${formatPveTraceValue(viewModel?.captured?.p2)} ` +
      `status=${formatPveTraceValue(viewModel?.status)} ` +
      `matchRound=${formatPveTraceValue(viewModel?.round)}`
  );
}

export class GameController {
  constructor(options = {}) {
    this.username = options.username;
    this.timerDefault = options.timerSeconds ?? 30;
    this.matchTimeLimitSeconds = options.matchTimeLimitSeconds ?? 300;
    this.onUpdate = options.onUpdate ?? (() => {});
    this.onMatchComplete = options.onMatchComplete ?? (() => {});
    this.onRoundResolved = options.onRoundResolved ?? (() => {});
    this.onHotseatTurnTimeout = options.onHotseatTurnTimeout ?? (() => {});
    this.aiDifficulty = difficultyFromSettings(options.aiDifficulty);
    this.featuredRivalId = String(options.featuredRivalId ?? "").trim().toLowerCase() || null;
    this.gauntletMode = options.gauntletMode === true;
    this.gauntletRivalId = String(options.gauntletRivalId ?? "").trim().toLowerCase() || null;
    this.mode = options.mode ?? MATCH_MODE.PVE;
    this.trainingMode = options.trainingMode === true;
    this.trainingOpponentPersonality = this.trainingMode
      ? normalizeTrainingOpponentPersonality(options.trainingOpponentPersonality)
      : null;
    this.persistMatchResults = options.persistMatchResults ?? true;
    this.persistMatchResult = typeof options.persistMatchResult === "function" ? options.persistMatchResult : null;
    this.localAuthorityStoreFactory = options.localAuthorityStoreFactory ?? (() => createRoomStore());
    this.localPlayerNames = options.localPlayerNames ?? null;

    this.match = null;
    this.lastRound = null;
    this.activeWarClashCards = null;
    this.roundResultText = "No round played yet.";
    this.captured = { p1: 0, p2: 0 };
    this.timerSeconds = this.timerDefault;
    this.totalMatchSeconds = this.matchTimeLimitSeconds;
    this.timerId = null;
    this.matchClockId = null;
    this.isResolvingRound = false;
    this.completionNotified = false;
    this.pendingTimeLimitFinalization = false;

    this.hotseatTurn = "p1";
    this.pendingHotseatP1CardIndex = null;
    this.pendingHotseatP2CardIndex = null;
    this.matchStartedAtMs = null;
    this.localAuthority = null;
    this.localPveAuthoritativeRoundHistory = [];
  }

  isLocalPvp() {
    return this.mode === MATCH_MODE.LOCAL_PVP;
  }

  isPve() {
    return this.mode === MATCH_MODE.PVE;
  }

  getLocalAuthorityNames() {
    return {
      p1: String(this.localPlayerNames?.p1 ?? this.username ?? "Player 1").trim() || "Player 1",
      p2: String(this.localPlayerNames?.p2 ?? "Player 2").trim() || "Player 2"
    };
  }

  createLocalAuthorityMatch() {
    const store = this.localAuthorityStoreFactory();
    const hostSocket = createLocalAuthoritySocket("host");
    const guestSocket = createLocalAuthoritySocket("guest");
    const gauntletRival = this.isPve() ? getGauntletRivalById(this.gauntletRivalId) : null;
    const names = this.isLocalPvp()
      ? this.getLocalAuthorityNames()
      : {
          p1: String(this.username ?? "Player 1").trim() || "Player 1",
          p2:
            gauntletRival?.displayName ??
            (this.featuredRivalId === "crownfire_duelist" ? "Crownfire Duelist" : "EleMintz AI")
        };
    const createResult = store.createRoom(hostSocket, { username: names.p1 });

    if (!createResult?.ok || !createResult.room?.roomCode) {
      throw new Error(createResult?.error?.message ?? "Unable to initialize local PvP authority.");
    }

    const joinResult = store.joinRoom(guestSocket, createResult.room.roomCode, {
      username: names.p2,
      ...(this.isPve()
        ? {
            bot: true,
            aiDifficulty: this.aiDifficulty,
            ...(this.featuredRivalId ? { featuredRivalId: this.featuredRivalId } : {}),
            ...(this.gauntletRivalId ? { gauntletRivalId: this.gauntletRivalId } : {})
          }
        : {})
    });
    if (!joinResult?.ok || !joinResult.room) {
      throw new Error(
        joinResult?.error?.message ??
          (this.isPve()
            ? "Unable to initialize local PvE authority."
            : "Unable to initialize local PvP authority.")
      );
    }

    this.localAuthority = {
      store,
      roomCode: createResult.room.roomCode,
      hostSocket,
      guestSocket
    };

    this.match = buildLocalMatchFromAuthoritativeRoom(
      joinResult.room,
      this.match,
      this.mode,
      this.aiDifficulty
    );
  }

  syncLocalAuthorityState(room, roundResult = null) {
    if (!room) {
      return;
    }

    let effectiveRoom = room;
    if (this.isPve()) {
      this.localPveAuthoritativeRoundHistory = mergeAuthoritativeLocalPveRoundHistory(
        this.localPveAuthoritativeRoundHistory,
        room?.roundHistory ?? []
      );
      effectiveRoom = {
        ...room,
        roundHistory: this.localPveAuthoritativeRoundHistory
      };
    }

    this.match = buildLocalMatchFromAuthoritativeRoom(
      effectiveRoom,
      this.match,
      this.mode,
      this.aiDifficulty
    );
    if (room?.warActive && roundResult?.hostMove && roundResult?.guestMove) {
      this.activeWarClashCards = {
        p1Card: String(roundResult.hostMove ?? "").toLowerCase() || null,
        p2Card: String(roundResult.guestMove ?? "").toLowerCase() || null
      };
    } else if (!room?.warActive) {
      this.activeWarClashCards = null;
    }
    if (roundResult && (roundResult.outcomeType !== "war" || room.matchComplete)) {
      this.lastRound = buildLocalRoundFromAuthoritativeResult(roundResult, room);
      this.roundResultText = formatRoundResult(this.lastRound);
      this.onRoundResolved(this.lastRound);
    } else if (roundResult?.outcomeType === "war") {
      this.roundResultText = "WAR continues. Choose new cards for the next clash.";
    } else if (this.match?.status === "active") {
      this.roundResultText = this.match.war?.active
        ? "WAR continues. Choose new cards for the next clash."
        : "Choose a card to begin the next clash.";
    }

    this.recalculateCapturedTotals();

    if (this.isPve()) {
      logLocalPveTrace(room, this.match, this.getViewModel());
    }
  }

  rearmActiveRoundPresentation() {
    if (this.match?.status !== "active") {
      return;
    }

    this.roundResultText = this.match.war?.active
      ? "WAR continues. Choose new cards for the next clash."
      : "Choose a card to begin the next clash.";
  }

  completeLocalAuthorityMatch(options = {}) {
    if (!this.localAuthority?.store || !this.localAuthority?.hostSocket?.id) {
      return null;
    }

    const result = this.localAuthority.store.completeMatch(this.localAuthority.hostSocket.id, options);
    if (!result?.ok || !result.room) {
      return null;
    }

    this.syncLocalAuthorityState(result.room, null);
    return result.room;
  }

  completeLocalAuthorityMatchByCardCount(options = {}) {
    if (!this.localAuthority?.store || !this.localAuthority?.hostSocket?.id) {
      return null;
    }

    const result = this.localAuthority.store.completeMatchByCardCount(
      this.localAuthority.hostSocket.id,
      options
    );
    if (!result?.ok || !result.room) {
      return null;
    }

    this.syncLocalAuthorityState(result.room, null);
    return result.room;
  }

  startNewMatch() {
    this.localAuthority = null;
    this.match = this.isLocalPvp() || this.isPve()
      ? null
      : createMatch({ difficulty: this.aiDifficulty, mode: this.mode });
    this.lastRound = null;
    this.activeWarClashCards = null;
    this.roundResultText = "Match started.";
    this.captured = { p1: 0, p2: 0 };
    this.hotseatTurn = "p1";
    this.pendingHotseatP1CardIndex = null;
    this.pendingHotseatP2CardIndex = null;
    this.completionNotified = false;
    this.pendingTimeLimitFinalization = false;
    this.matchStartedAtMs = Date.now();
    this.localPveAuthoritativeRoundHistory = [];

    if (this.isLocalPvp() || this.isPve()) {
      this.createLocalAuthorityMatch();
    }

    if (this.match?.meta) {
      this.match.meta.startedAt = new Date(this.matchStartedAtMs).toISOString();
      this.match.meta.endedAt = null;
      this.match.meta.durationMs = 0;
    }

    this.resetTimer();
    this.resetMatchClock();
    this.recalculateCapturedTotals();

    if (this.trainingMode) {
      this.stopTimer();
    } else if (!this.isLocalPvp()) {
      this.startTimer();
    } else {
      this.stopTimer();
    }

    if (this.trainingMode) {
      this.stopMatchClock();
    } else {
      this.startMatchClock();
    }
    this.onUpdate();
  }

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  stopMatchClock() {
    if (this.matchClockId) {
      clearInterval(this.matchClockId);
      this.matchClockId = null;
    }
  }


  recalculateCapturedTotals() {
    if (!this.match) {
      this.captured = { p1: 0, p2: 0 };
      return;
    }

    const p1Stats = deriveMatchStats(this.match, "p1");
    const p2Stats = deriveMatchStats(this.match, "p2");

    this.captured = {
      p1: Math.max(0, Number(p1Stats?.cardsCaptured ?? 0)),
      p2: Math.max(0, Number(p2Stats?.cardsCaptured ?? 0))
    };
  }

  resetTimer() {
    this.timerSeconds = this.timerDefault;
  }

  resetMatchClock() {
    this.totalMatchSeconds = this.matchTimeLimitSeconds;
  }

  startMatchClock() {
    if (this.trainingMode) {
      this.stopMatchClock();
      return;
    }

    this.stopMatchClock();

    this.matchClockId = setInterval(async () => {
      if (this.trainingMode) {
        this.stopMatchClock();
        return;
      }

      if (!this.match || this.match.status !== "active") {
        this.stopMatchClock();
        return;
      }

      this.totalMatchSeconds -= 1;
      if (this.totalMatchSeconds <= 0) {
        this.totalMatchSeconds = 0;
        this.stopMatchClock();
        await this.finalizeByTimeLimit();
        return;
      }

      this.onUpdate();
    }, 1000);
  }

  startTimer() {
    if (this.trainingMode) {
      this.stopTimer();
      return;
    }

    this.stopTimer();

    this.timerId = setInterval(async () => {
      if (this.trainingMode) {
        this.stopTimer();
        return;
      }

      if (this.isResolvingRound || !this.match || this.match.status !== "active") {
        return;
      }

      this.timerSeconds -= 1;
      if (this.timerSeconds <= 0) {
        this.timerSeconds = 0;

        if (this.isLocalPvp()) {
          this.stopTimer();
          await this.onHotseatTurnTimeout(this.hotseatTurn);
          return;
        }

        const fallbackCardIndex = this.getFirstPlayableCardIndex("p1");
        if (fallbackCardIndex !== null) {
          await this.playCard(fallbackCardIndex);
        }
        return;
      }

      this.onUpdate();
    }, 1000);
  }

  resumeLocalTurnTimer() {
    if (!this.isLocalPvp() || this.timerId || !this.match || this.match.status !== "active") {
      return;
    }

    this.startTimer();
  }

  pauseLocalTurnTimer() {
    if (!this.isLocalPvp()) {
      return;
    }

    this.stopTimer();
  }

  getHandForTurn(turn) {
    if (!this.match) {
      return [];
    }

    return turn === "p2" ? this.match.players.p2.hand : this.match.players.p1.hand;
  }

  getRecentMovesForTurn(turn) {
    if (!this.match) {
      return [];
    }

    return getRecentHistoryMoves(this.match.history, turn === "p2" ? "p2Card" : "p1Card");
  }

  getBlockedFatiguedElementForTurn(turn) {
    return getBlockedFatiguedElementForCounts(
      buildElementCountsFromCards(this.getHandForTurn(turn)),
      this.getRecentMovesForTurn(turn)
    );
  }

  isFatiguedSelectionBlocked(turn, card) {
    const blockedElement = this.getBlockedFatiguedElementForTurn(turn);
    return Boolean(blockedElement) && blockedElement === normalizeElementMove(card);
  }

  getSelectableCardIndices(turn) {
    const hand = this.getHandForTurn(turn);
    const blockedElement = this.getBlockedFatiguedElementForTurn(turn);

    if (!Array.isArray(hand) || hand.length === 0) {
      return [];
    }

    return hand
      .map((card, index) => ({ card: normalizeElementMove(card), index }))
      .filter(({ card }) => card && card !== blockedElement)
      .map(({ index }) => index);
  }

  getFirstPlayableCardIndex(turn) {
    return this.getSelectableCardIndices(turn)[0] ?? null;
  }

  getSelectionFatigueSummary() {
    const activeTurn = this.isLocalPvp() ? this.hotseatTurn : "p1";
    const blockedElement = this.getBlockedFatiguedElementForTurn(activeTurn);
    return blockedElement
      ? {
          blockedElement,
          label: "FATIGUED",
          message: FATIGUE_TOOLTIP
        }
      : null;
  }

  pickRandomCardIndex(turn, rng = Math.random) {
    const playableIndices = this.getSelectableCardIndices(turn);
    if (playableIndices.length === 0) {
      return null;
    }

    return playableIndices[Math.floor(rng() * playableIndices.length)] ?? null;
  }

  setPendingHotseatSelection(turn, cardIndex) {
    if (!this.isLocalPvp()) {
      return false;
    }

    const hand = this.getHandForTurn(turn);
    const resolvedIndex = safeCardIndex(hand, cardIndex);
    if (resolvedIndex === null) {
      return false;
    }

    if (turn === "p2") {
      this.pendingHotseatP2CardIndex = resolvedIndex;
      return true;
    }

    this.pendingHotseatP1CardIndex = resolvedIndex;
    return true;
  }

  async finalizeCompletedMatch() {
    if (!this.match || this.match.status !== "completed" || this.completionNotified) {
      return;
    }

    this.pendingTimeLimitFinalization = false;
    this.completionNotified = true;
    this.stopTimer();
    this.stopMatchClock();

    const endedAtMs = Date.now();
    const startedAtMs = Number(this.matchStartedAtMs ?? endedAtMs);
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    if (this.match?.meta) {
      this.match.meta.startedAt = this.match.meta.startedAt ?? new Date(startedAtMs).toISOString();
      this.match.meta.endedAt = new Date(endedAtMs).toISOString();
      this.match.meta.durationMs = durationMs;
    }

    let persisted = null;
    if (this.persistMatchResults) {
      try {
        persisted = this.persistMatchResult
          ? await this.persistMatchResult(this.match)
          : await window.elemintz.state.recordMatchResult({
              username: this.username,
              perspective: "p1",
              matchState: this.match
            });
      } catch (error) {
        console.error("Failed to persist match results", error);
      }
    }

    await this.onMatchComplete({
      match: this.match,
      persisted
    });
  }

  async finalizeByTimeLimit() {
    if (!this.match || this.match.status !== "active") {
      this.pendingTimeLimitFinalization = false;
      return;
    }

    if (this.isResolvingRound) {
      this.pendingTimeLimitFinalization = true;
      return;
    }

    this.pendingTimeLimitFinalization = false;
    if ((this.isLocalPvp() || this.isPve()) && this.localAuthority?.store) {
      this.completeLocalAuthorityMatchByCardCount({ reason: "time_limit" });
      this.onUpdate();
      await this.finalizeCompletedMatch();
      return;
    }

    completeMatchByCardCount(this.match, { reason: "time_limit" });
    this.onUpdate();
    await this.finalizeCompletedMatch();
  }

  async flushPendingTimeLimitFinalization() {
    if (!this.pendingTimeLimitFinalization) {
      return false;
    }

    if (!this.match || this.match.status !== "active") {
      this.pendingTimeLimitFinalization = false;
      return false;
    }

    this.pendingTimeLimitFinalization = false;
    await this.finalizeByTimeLimit();
    return true;
  }

  async quitMatch({ quitter = "p1", reason = "forfeit" } = {}) {
    if (!this.match || this.match.status !== "active") {
      return;
    }

    if ((this.isLocalPvp() || this.isPve()) && this.localAuthority?.store) {
      const winner =
        quitter === "p1" ? "guest" : quitter === "p2" ? "host" : "draw";
      this.completeLocalAuthorityMatch({ winner, reason });
      this.onUpdate();
      await this.finalizeCompletedMatch();
      return;
    }

    const winner =
      quitter === "p1" ? "p2" : quitter === "p2" ? "p1" : "draw";
    completeMatch(this.match, { winner, reason });
    this.onUpdate();
    await this.finalizeCompletedMatch();
  }

  async finalizeRound({ p1CardIndex, p2CardIndex }) {
    // Use manual WAR stepping for both PvE and local PvP so WAR never auto-resolves
    // without a fresh player choice for each continuation clash.
    const result = playRoundManualWarStep(this.match, {
      p1CardIndex,
      p2CardIndex
    });

    if (result.round) {
      this.lastRound = result.round;
      this.roundResultText = formatRoundResult(result.round);
      this.recalculateCapturedTotals();
      this.onRoundResolved(result.round);
    } else if (result.status === "war_continues") {
      this.roundResultText = "WAR continues. Choose new cards for the next clash.";
    }

    if (this.match.status === "completed") {
      this.recalculateCapturedTotals();
      await this.finalizeCompletedMatch();
    } else if (this.trainingMode) {
      this.stopTimer();
      this.stopMatchClock();
      this.onUpdate();
    } else if (!this.isLocalPvp()) {
      this.resetTimer();
      this.startTimer();
      this.onUpdate();
    } else {
      this.resetTimer();
      this.onUpdate();
    }

    return result;
  }

  async maybeAutoResolveLocalWarExhaustion() {
    if (!this.isLocalPvp() || !this.match || this.match.status !== "active" || !this.match.war?.active) {
      return null;
    }

    const p1CanContinue = hasRequiredWarCards(this.match.players.p1.hand);
    const p2CanContinue = hasRequiredWarCards(this.match.players.p2.hand);
    if (p1CanContinue && p2CanContinue) {
      return null;
    }

    const result = await this.finalizeRound({
      p1CardIndex: 0,
      p2CardIndex: 0
    });

    return {
      status: "round_resolved",
      round: result.round ?? null,
      matchCompleted: this.match.status === "completed"
    };
  }

  async maybeAutoResolveAuthoritativeWarExhaustion() {
    if (
      !this.localAuthority?.store ||
      !this.localAuthority?.hostSocket?.id ||
      !this.match ||
      this.match.status !== "active" ||
      !this.match.war?.active
    ) {
      return null;
    }

    const p1CanContinue = hasRequiredWarCards(this.match.players.p1.hand);
    const p2CanContinue = hasRequiredWarCards(this.match.players.p2.hand);
    if (p1CanContinue && p2CanContinue) {
      return null;
    }

    const winner = p1CanContinue ? "host" : p2CanContinue ? "guest" : "draw";
    const completedRoom = this.completeLocalAuthorityMatch({
      winner,
      reason: "hand_exhaustion"
    });
    if (!completedRoom?.matchComplete) {
      return null;
    }

    await this.finalizeCompletedMatch();

    return {
      status: "resolved",
      round: this.lastRound,
      revealedCards: {
        p1Card: null,
        p2Card: null
      }
    };
  }

  async playCard(playerCardIndex) {
    if (this.isLocalPvp()) {
      return { skipped: true, reason: "local-pvp-uses-hotseat-selection" };
    }

    if (!this.match || this.match.status !== "active" || this.isResolvingRound) {
      return { skipped: true, reason: "match-unavailable" };
    }

    this.isResolvingRound = true;
    this.onUpdate();

    try {
      const resolvedPlayerIndex = safeCardIndex(this.match.players.p1.hand, playerCardIndex);
      if (resolvedPlayerIndex === null) {
        return { skipped: true, reason: "player-card-unavailable" };
      }

      const playerCard = getCardAtIndex(this.match.players.p1.hand, resolvedPlayerIndex);
      if (this.isFatiguedSelectionBlocked("p1", playerCard)) {
        return { skipped: true, reason: "player-card-fatigued" };
      }

      if (
        this.localAuthority?.store &&
        this.localAuthority?.hostSocket?.id &&
        this.localAuthority?.guestSocket?.id
      ) {
        const hostSubmit = this.localAuthority.store.submitMove(
          this.localAuthority.hostSocket.id,
          playerCard
        );
        if (!hostSubmit?.ok || !hostSubmit.room) {
          return {
            skipped: true,
            reason: hostSubmit?.error?.code ?? "local-authority-player-submit-failed"
          };
        }

        this.syncLocalAuthorityState(hostSubmit.room, hostSubmit.roundResult ?? null);

        const revealedCards = {
          p1Card: playerCard,
          p2Card: String(hostSubmit.roundResult?.guestMove ?? "").toLowerCase() || null
        };

        const matchCompleted =
          this.match.status === "completed" || Boolean(hostSubmit.room.matchComplete);
        const warContinues =
          hostSubmit.roundResult?.outcomeType === "war" && !matchCompleted;
        const forcedWarExhaustionResolution = matchCompleted
          ? null
          : await this.maybeAutoResolveAuthoritativeWarExhaustion();

        if (matchCompleted) {
          await this.finalizeCompletedMatch();
        } else if (forcedWarExhaustionResolution) {
          return forcedWarExhaustionResolution;
        } else if (this.trainingMode) {
          this.stopTimer();
          this.stopMatchClock();
          this.onUpdate();
        } else {
          this.resetTimer();
          this.startTimer();
          this.onUpdate();
        }

        return {
          status: warContinues ? "war_continues" : "resolved",
          round: warContinues ? null : this.lastRound,
          revealedCards
        };
      }

      const recentPlayerMoves = getRecentHistoryMoves(this.match.history, "p1Card");
      const recentOpponentMoves = getRecentHistoryMoves(this.match.history, "p2Card");
      const publicState = {
        aiCardsRemaining: this.match.players.p2.hand.length,
        playerCardsRemaining: this.match.players.p1.hand.length,
        playerElementCounts: buildElementCountsFromCards(this.match.players.p1.hand),
        recentPlayerMoves,
        aiCaptured: this.captured.p2,
        playerCaptured: this.captured.p1,
        warActive: Boolean(this.match.war?.active),
        pileCount: Array.isArray(this.match.currentPile) ? this.match.currentPile.length : 0,
        totalWarClashes: Number(this.match.war?.clashes ?? 0)
      };
      const blockedOpponentElement = getBlockedFatiguedElementForCounts(
        buildElementCountsFromCards(this.match.players.p2.hand),
        recentOpponentMoves
      );
      const legalOpponentOptions = buildLegalCardOptions(this.match.players.p2.hand, blockedOpponentElement);
      const legalOpponentHand = this.match.players.p2.hand.filter(
        (card) => normalizeElementMove(card) !== blockedOpponentElement
      );
      const gauntletRival = this.gauntletMode ? getGauntletRivalById(this.gauntletRivalId) : null;
      const opponentIndex = this.trainingMode
        ? chooseTrainingOpponentCardIndex({
            personality: this.trainingOpponentPersonality,
            legalOptions: legalOpponentOptions,
            recentPlayerMoves,
            recentOpponentMoves,
            publicState
          })
        : gauntletRival
          ? chooseGauntletRivalCardIndex(legalOpponentHand, {
              rival: gauntletRival,
              turnIndex: Math.max(0, Number(this.match?.round ?? 1) - 1),
              playerPreviousElement: recentPlayerMoves.at(-1) ?? null,
              publicState
            })
          : chooseAiCardIndex(legalOpponentHand, {
              difficulty: this.aiDifficulty,
              publicState
            });
      const revealedCards = {
        p1Card: playerCard,
        p2Card: this.trainingMode
          ? getCardAtIndex(this.match.players.p2.hand, opponentIndex)
          : getCardAtIndex(legalOpponentHand, opponentIndex)
      };

      const result = await this.finalizeRound({
        p1CardIndex: resolvedPlayerIndex,
        p2CardIndex: opponentIndex
      });

      return {
        ...result,
        revealedCards
      };
    } finally {
      this.isResolvingRound = false;
      await this.flushPendingTimeLimitFinalization();
      this.onUpdate();
    }
  }

  async submitHotseatSelection(cardIndex) {
    if (!this.isLocalPvp()) {
      return { status: "ignored", reason: "not-local-pvp" };
    }

    if (!this.match || this.match.status !== "active" || this.isResolvingRound) {
      return { status: "ignored", reason: "match-unavailable" };
    }

    if (this.hotseatTurn === "p1") {
      const resolvedIndex = safeCardIndex(this.match.players.p1.hand, cardIndex);
      if (resolvedIndex === null) {
        return { status: "ignored", reason: "player-1-has-no-cards" };
      }

      if (this.isFatiguedSelectionBlocked("p1", getCardAtIndex(this.match.players.p1.hand, resolvedIndex))) {
        return { status: "ignored", reason: "player-1-card-fatigued" };
      }

      this.pendingHotseatP1CardIndex = resolvedIndex;
      this.hotseatTurn = "p2";
      this.onUpdate();
      return {
        status: "pass_to_p2"
      };
    }

    const p2CardIndex = safeCardIndex(this.match.players.p2.hand, cardIndex);
    if (this.pendingHotseatP1CardIndex === null || p2CardIndex === null) {
      return { status: "ignored", reason: "pending-selection-missing" };
    }

    if (this.isFatiguedSelectionBlocked("p2", getCardAtIndex(this.match.players.p2.hand, p2CardIndex))) {
      return { status: "ignored", reason: "player-2-card-fatigued" };
    }

    this.pendingHotseatP2CardIndex = p2CardIndex;
    this.hotseatTurn = "p1";
    this.onUpdate();

    return {
      status: "pass_to_p1"
    };
  }

  async confirmHotseatRound() {
    if (!this.isLocalPvp()) {
      return { status: "ignored", reason: "not-local-pvp" };
    }

    if (!this.match || this.match.status !== "active" || this.isResolvingRound) {
      return { status: "ignored", reason: "match-unavailable" };
    }

    if (this.pendingHotseatP1CardIndex === null || this.pendingHotseatP2CardIndex === null) {
      return { status: "ignored", reason: "pending-selection-missing" };
    }

    this.isResolvingRound = true;
    this.onUpdate();

    try {
      const revealedCards = {
        p1Card: getCardAtIndex(this.match.players.p1.hand, this.pendingHotseatP1CardIndex),
        p2Card: getCardAtIndex(this.match.players.p2.hand, this.pendingHotseatP2CardIndex)
      };

      if (!this.localAuthority?.store || !this.localAuthority?.hostSocket?.id || !this.localAuthority?.guestSocket?.id) {
        const result = await this.finalizeRound({
          p1CardIndex: this.pendingHotseatP1CardIndex,
          p2CardIndex: this.pendingHotseatP2CardIndex
        });

        this.pendingHotseatP1CardIndex = null;
        this.pendingHotseatP2CardIndex = null;
        this.hotseatTurn = "p1";

        if (result.status === "war_continues") {
          const forcedResolution = await this.maybeAutoResolveLocalWarExhaustion();
          if (forcedResolution) {
            return forcedResolution;
          }

          return {
            status: "war_continues",
            round: null,
            matchCompleted: false,
            war: result.war,
            revealedCards
          };
        }

        return {
          status: "round_resolved",
          round: result.round,
          matchCompleted: this.match.status === "completed",
          revealedCards
        };
      }

      const hostSubmit = this.localAuthority.store.submitMove(
        this.localAuthority.hostSocket.id,
        revealedCards.p1Card
      );
      if (!hostSubmit?.ok) {
        return {
          status: "ignored",
          reason: hostSubmit?.error?.code ?? "local-authority-host-submit-failed"
        };
      }

      const guestSubmit = this.localAuthority.store.submitMove(
        this.localAuthority.guestSocket.id,
        revealedCards.p2Card
      );
      if (!guestSubmit?.ok || !guestSubmit.room) {
        return {
          status: "ignored",
          reason: guestSubmit?.error?.code ?? "local-authority-guest-submit-failed"
        };
      }

      this.syncLocalAuthorityState(guestSubmit.room, guestSubmit.roundResult ?? null);

      this.pendingHotseatP1CardIndex = null;
      this.pendingHotseatP2CardIndex = null;
      this.hotseatTurn = "p1";

      if (guestSubmit.roundResult?.outcomeType === "war" && !guestSubmit.room.matchComplete) {
        return {
          status: "war_continues",
          round: null,
          matchCompleted: false,
          war: {
            clashes: Array.isArray(guestSubmit.room.warRounds) ? guestSubmit.room.warRounds.length : 0,
            pileSize:
              (Array.isArray(guestSubmit.room.warPot?.host) ? guestSubmit.room.warPot.host.length : 0) +
              (Array.isArray(guestSubmit.room.warPot?.guest) ? guestSubmit.room.warPot.guest.length : 0),
            pileSizes: Array.isArray(guestSubmit.room.warRounds)
              ? guestSubmit.room.warRounds.map((_, index) => (index + 1) * 2)
              : []
          },
          revealedCards
        };
      }

      if (this.match.status === "completed") {
        await this.finalizeCompletedMatch();
      }

      return {
        status: "round_resolved",
        round: this.lastRound,
        matchCompleted: this.match.status === "completed",
        revealedCards
      };
    } finally {
      this.isResolvingRound = false;
      await this.flushPendingTimeLimitFinalization();
      this.onUpdate();
    }
  }

  getViewModel() {
    if (!this.match) {
      return null;
    }

    const summary = getMatchSummary(this.match);
    const warActive = Boolean(this.match.war?.active);
    const roundOutcome = classifyRoundOutcome(this.lastRound, warActive);
    const committedWarPile = warActive && Array.isArray(this.match.currentPile)
      ? [...this.match.currentPile]
      : [];
    const warPileCount = committedWarPile.length;
    const playerSelectableIndices = this.getSelectableCardIndices("p1");
    const opponentRemainingByElement = buildElementCountsFromCards(this.match.players.p2.hand);
    const coach = evaluateTrainingCoach({
      trainingActive: this.trainingMode,
      legalPlayableElements: playerSelectableIndices
        .map((index) => normalizeElementMove(this.match.players.p1.hand[index]))
        .filter(Boolean),
      playerRemainingByElement: buildElementCountsFromCards(this.match.players.p1.hand),
      opponentRemainingByElement,
      visibleHistory: Array.isArray(this.match.history)
        ? this.match.history.map((entry) => ({
            round: entry?.round ?? null,
            p1Card: normalizeElementMove(entry?.p1Card),
            p2Card: normalizeElementMove(entry?.p2Card),
            result: entry?.result ?? null,
            warClashes: Math.max(0, Number(entry?.warClashes ?? 0) || 0)
          }))
        : [],
      recentPlayerMoves: this.getRecentMovesForTurn("p1"),
      recentOpponentMoves: this.getRecentMovesForTurn("p2"),
      fatigue: {
        playerBlockedElement: this.getBlockedFatiguedElementForTurn("p1"),
        opponentBlockedElement: this.getBlockedFatiguedElementForTurn("p2")
      },
      phase: warActive ? "war" : "normal",
      availableCards: {
        player: this.match.players.p1.hand.length,
        opponent: this.match.players.p2.hand.length
      },
      war: {
        pileCount: warPileCount,
        commitmentTotals: {
          player: committedWarPile.filter((_, index) => index % 2 === 0).length,
          opponent: committedWarPile.filter((_, index) => index % 2 === 1).length
        }
      },
      captured: { ...this.captured }
    });

    return {
      status: summary.status,
      winner: summary.winner,
      endReason: summary.endReason,
      round: summary.round,
      timerSeconds: this.timerSeconds,
      totalMatchSeconds: this.totalMatchSeconds,
      trainingMode: this.trainingMode,
      mode: this.mode,
      hotseatTurn: this.hotseatTurn,
      hotseatPending:
        this.pendingHotseatP1CardIndex !== null || this.pendingHotseatP2CardIndex !== null,
      playerHand: [...this.match.players.p1.hand],
      opponentHand: [...this.match.players.p2.hand],
      warActive,
      pileCount: warPileCount,
      totalWarClashes: summary.wars,
      warPileCards: committedWarPile,
      warPileSizes: warActive ? [...(this.match.war?.pendingPileSizes ?? [])] : [],
      activeWarClashCards: warActive && this.activeWarClashCards
        ? { ...this.activeWarClashCards }
        : null,
      captured: { ...this.captured },
      lastRound: this.lastRound,
      roundResult: this.roundResultText,
      roundOutcome,
      canSelectCard: this.match.status === "active" && !this.isResolvingRound,
      selectionFatigue: this.getSelectionFatigueSummary(),
      coach
    };
  }
}

export { MATCH_MODE };







