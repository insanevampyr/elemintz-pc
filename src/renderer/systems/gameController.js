import {
  AI_DIFFICULTY,
  WAR_REQUIRED_CARDS,
  chooseAiCardIndex,
  completeMatch,
  completeMatchByCardCount,
  createMatch,
  getMatchSummary,
  playRoundManualWarStep
} from "../../engine/index.js";
import { createRoomStore } from "../../multiplayer/rooms.js";
import { deriveMatchStats } from "../../state/statsTracking.js";

const MATCH_MODE = Object.freeze({
  PVE: "pve",
  LOCAL_PVP: "local_pvp"
});
const LOCAL_AUTHORITY_ELEMENT_ORDER = Object.freeze(["fire", "water", "earth", "wind"]);

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

function buildLocalHistoryFromRoundHistory(roundHistory = [], roomWinner = null) {
  const history = [];

  for (let index = 0; index < roundHistory.length; index += 1) {
    const entry = roundHistory[index];
    const outcomeType = String(entry?.outcomeType ?? "");

    if (outcomeType === "war") {
      history.push({
        result: "none",
        warClashes: 0,
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

function buildLocalMatchFromAuthoritativeRoom(room, existingMatch = null, mode = MATCH_MODE.LOCAL_PVP) {
  const matchId =
    room?.serverMatchState?.matchId ??
    room?.roomCode ??
    existingMatch?.id ??
    (mode === MATCH_MODE.PVE ? "local-pve-authoritative" : "local-pvp-authoritative");
  const history = buildLocalHistoryFromRoundHistory(room?.roundHistory ?? [], room?.winner ?? null);
  const p1Hand = expandAuthoritativeHand(room?.hostHand);
  const p2Hand = expandAuthoritativeHand(room?.guestHand);
  const currentPile = room?.warActive ? interleaveWarPotCards(room?.warPot) : [];
  const pendingWarSizes =
    room?.warActive && Array.isArray(room?.warRounds)
      ? room.warRounds.map((_, index) => (index + 1) * 2)
      : [];

  return {
    id: matchId,
    status: room?.matchComplete ? "completed" : "active",
    round: Math.max(0, Number(room?.roundNumber ?? 1) - 1),
    mode,
    difficulty:
      existingMatch?.difficulty ??
      (mode === MATCH_MODE.PVE ? AI_DIFFICULTY.NORMAL : "authoritative_local_pvp"),
    winner: room?.matchComplete ? resolveLocalWinnerFromRoomWinner(room?.winner) : null,
    endReason: room?.matchComplete ? room?.winReason ?? null : null,
    currentPile,
    players: {
      p1: { hand: p1Hand, wonRounds: countWonRounds(history, "p1") },
      p2: { hand: p2Hand, wonRounds: countWonRounds(history, "p2") }
    },
    war: {
      active: Boolean(room?.warActive),
      clashes: pendingWarSizes.length,
      pendingClashes: pendingWarSizes.length,
      pendingPileSizes: pendingWarSizes
    },
    history,
    meta: {
      totalCards: existingMatch?.meta?.totalCards ?? 16,
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

  const capturedOpponentCards = getOpponentCardsCaptured(round);

  if (round.result === "none") {
    return "No effect. Both players keep their own card.";
  }

  if (round.warClashes > 0) {
    if (round.result === "p1") {
      return `WAR triggered. Player wins and captured ${capturedOpponentCards} opponent cards.`;
    }

    if (round.result === "p2") {
      return `WAR triggered. Opponent wins and captured ${capturedOpponentCards} opponent cards.`;
    }
  }

  if (round.result === "p1") {
    return `Player wins the round and captured ${capturedOpponentCards} opponent cards.`;
  }

  if (round.result === "p2") {
    return `Opponent wins the round and captured ${capturedOpponentCards} opponent cards.`;
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
    this.mode = options.mode ?? MATCH_MODE.PVE;
    this.persistMatchResults = options.persistMatchResults ?? true;
    this.localAuthorityStoreFactory = options.localAuthorityStoreFactory ?? (() => createRoomStore());
    this.localPlayerNames = options.localPlayerNames ?? null;

    this.match = null;
    this.lastRound = null;
    this.roundResultText = "No round played yet.";
    this.captured = { p1: 0, p2: 0 };
    this.timerSeconds = this.timerDefault;
    this.totalMatchSeconds = this.matchTimeLimitSeconds;
    this.timerId = null;
    this.matchClockId = null;
    this.isResolvingRound = false;
    this.completionNotified = false;

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
    const names = this.isLocalPvp()
      ? this.getLocalAuthorityNames()
      : {
          p1: String(this.username ?? "Player 1").trim() || "Player 1",
          p2: "EleMintz AI"
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
            aiDifficulty: this.aiDifficulty
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

    this.match = buildLocalMatchFromAuthoritativeRoom(joinResult.room, this.match, this.mode);
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

    this.match = buildLocalMatchFromAuthoritativeRoom(effectiveRoom, this.match, this.mode);
    if (roundResult && (roundResult.outcomeType !== "war" || room.matchComplete)) {
      this.lastRound = buildLocalRoundFromAuthoritativeResult(roundResult, room);
      this.roundResultText = formatRoundResult(this.lastRound);
      this.onRoundResolved(this.lastRound);
    } else if (roundResult?.outcomeType === "war") {
      this.lastRound = null;
      this.roundResultText = "WAR continues. Choose new cards for the next clash.";
    } else if (this.match?.status === "active") {
      this.lastRound = null;
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

    this.lastRound = null;
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
    this.roundResultText = "Match started.";
    this.captured = { p1: 0, p2: 0 };
    this.hotseatTurn = "p1";
    this.pendingHotseatP1CardIndex = null;
    this.pendingHotseatP2CardIndex = null;
    this.completionNotified = false;
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

    if (!this.isLocalPvp()) {
      this.startTimer();
    } else {
      this.stopTimer();
    }

    this.startMatchClock();
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
    this.stopMatchClock();

    this.matchClockId = setInterval(async () => {
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
    this.stopTimer();

    this.timerId = setInterval(async () => {
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

        await this.playCard(0);
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

  pickRandomCardIndex(turn, rng = Math.random) {
    const hand = this.getHandForTurn(turn);
    if (!Array.isArray(hand) || hand.length === 0) {
      return null;
    }

    return Math.floor(rng() * hand.length);
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
        persisted = await window.elemintz.state.recordMatchResult({
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
    if (!this.match || this.match.status !== "active" || this.isResolvingRound) {
      return;
    }

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

        if (this.match.status === "completed") {
          await this.finalizeCompletedMatch();
        } else {
          this.resetTimer();
          this.startTimer();
          this.onUpdate();
        }

        return {
          status:
            hostSubmit.roundResult?.outcomeType === "war" && !hostSubmit.room.matchComplete
              ? "war_continues"
              : "resolved",
          round:
            hostSubmit.roundResult?.outcomeType === "war" && !hostSubmit.room.matchComplete
              ? null
              : this.lastRound,
          revealedCards
        };
      }

      const opponentIndex = chooseAiCardIndex(this.match.players.p2.hand, {
        difficulty: this.aiDifficulty,
        publicState: {
          aiCardsRemaining: this.match.players.p2.hand.length,
          playerCardsRemaining: this.match.players.p1.hand.length,
          aiCaptured: this.captured.p2,
          playerCaptured: this.captured.p1,
          warActive: Boolean(this.match.war?.active),
          pileCount: Array.isArray(this.match.currentPile) ? this.match.currentPile.length : 0,
          totalWarClashes: Number(this.match.war?.clashes ?? 0)
        }
      });
      const revealedCards = {
        p1Card: playerCard,
        p2Card: getCardAtIndex(this.match.players.p2.hand, opponentIndex)
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

    return {
      status: summary.status,
      winner: summary.winner,
      endReason: summary.endReason,
      round: summary.round,
      timerSeconds: this.timerSeconds,
      totalMatchSeconds: this.totalMatchSeconds,
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
      captured: { ...this.captured },
      lastRound: this.lastRound,
      roundResult: this.roundResultText,
      roundOutcome,
      canSelectCard: this.match.status === "active" && !this.isResolvingRound
    };
  }
}

export { MATCH_MODE };







