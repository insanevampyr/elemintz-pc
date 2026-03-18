import {
  AI_DIFFICULTY,
  chooseAiCardIndex,
  completeMatch,
  completeMatchByCardCount,
  createMatch,
  getMatchSummary,  playRoundManualWarStep
} from "../../engine/index.js";

const MATCH_MODE = Object.freeze({
  PVE: "pve",
  LOCAL_PVP: "local_pvp"
});

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
  }

  isLocalPvp() {
    return this.mode === MATCH_MODE.LOCAL_PVP;
  }

  startNewMatch() {
    this.match = createMatch({ difficulty: this.aiDifficulty, mode: this.mode });
    this.lastRound = null;
    this.roundResultText = "Match started.";
    this.captured = { p1: 0, p2: 0 };
    this.hotseatTurn = "p1";
    this.pendingHotseatP1CardIndex = null;
    this.pendingHotseatP2CardIndex = null;
    this.completionNotified = false;
    this.matchStartedAtMs = Date.now();

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

    const history = Array.isArray(this.match.history) ? this.match.history : [];
    let p1Captured = 0;
    let p2Captured = 0;

    for (const round of history) {
      const captured = getOpponentCardsCaptured(round);
      if (round?.result === "p1") {
        p1Captured += captured;
      } else if (round?.result === "p2") {
        p2Captured += captured;
      }
    }

    this.captured = {
      p1: p1Captured,
      p2: p2Captured
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

    this.onMatchComplete({
      match: this.match,
      persisted
    });
  }

  async finalizeByTimeLimit() {
    if (!this.match || this.match.status !== "active" || this.isResolvingRound) {
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

    const p1CanContinue = this.match.players.p1.hand.length > 0;
    const p2CanContinue = this.match.players.p2.hand.length > 0;
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
        p1Card: getCardAtIndex(this.match.players.p1.hand, resolvedPlayerIndex),
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







