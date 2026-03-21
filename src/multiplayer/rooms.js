const ROOM_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_DIGITS = "23456789";
const INITIAL_HAND_COUNTS = Object.freeze({
  fire: 2,
  water: 2,
  earth: 2,
  wind: 2
});
const DEFAULT_EQUIPPED_COSMETICS = Object.freeze({
  avatar: "default_avatar",
  background: "default_background",
  cardBack: "default_card_back",
  elementCardVariant: Object.freeze({
    fire: "default_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  }),
  title: "Initiate",
  badge: "none"
});

function randomChar(source, random) {
  const index = Math.floor(random() * source.length);
  return source[index] ?? source[0];
}

function generateRoomCode(random = Math.random) {
  let code = "";

  for (let index = 0; index < 3; index += 1) {
    code += randomChar(ROOM_CODE_LETTERS, random);
  }

  for (let index = 0; index < 3; index += 1) {
    code += randomChar(ROOM_CODE_DIGITS, random);
  }

  return code;
}

function sanitizeRoomCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getRuntimeEdgeGuards(room) {
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    return {};
  }

  if (!room._runtimeEdgeGuards || typeof room._runtimeEdgeGuards !== "object") {
    Object.defineProperty(room, "_runtimeEdgeGuards", {
      value: {},
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  return room._runtimeEdgeGuards;
}

function normalizeUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEquippedCosmetics(equippedCosmetics) {
  const variants = equippedCosmetics?.elementCardVariant;

  return {
    avatar: String(equippedCosmetics?.avatar ?? DEFAULT_EQUIPPED_COSMETICS.avatar),
    background: String(equippedCosmetics?.background ?? DEFAULT_EQUIPPED_COSMETICS.background),
    cardBack: String(equippedCosmetics?.cardBack ?? DEFAULT_EQUIPPED_COSMETICS.cardBack),
    elementCardVariant: {
      fire: String(variants?.fire ?? DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.fire),
      water: String(variants?.water ?? DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.water),
      earth: String(variants?.earth ?? DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.earth),
      wind: String(variants?.wind ?? DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.wind)
    },
    title: String(equippedCosmetics?.title ?? DEFAULT_EQUIPPED_COSMETICS.title),
    badge: String(equippedCosmetics?.badge ?? DEFAULT_EQUIPPED_COSMETICS.badge)
  };
}

// Runtime room processing only supports the four elemental cards. Reuse this
// helper anywhere we need to contain malformed live room data without changing
// valid state that is already safe.
function isValidElement(value) {
  return Object.hasOwn(INITIAL_HAND_COUNTS, value);
}

// Match/round guard helpers should coerce malformed counters to safe,
// non-negative integers without touching valid numbers that are already safe.
function safeRuntimeCount(value, fallback = 0) {
  // Treat nullish/blank values as malformed input so callers can preserve their
  // intended safe default instead of accidentally coercing null -> 0.
  if (value == null || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.floor(numeric));
}

// Room hands are consumed by move legality checks and round resolution. Repair
// only missing/invalid element counters so gameplay code never reads malformed
// hand data.
export function guardRuntimeHandState(hand, logger = console) {
  const nextHand = {};
  let repaired = false;

  for (const element of Object.keys(INITIAL_HAND_COUNTS)) {
    const currentValue = hand?.[element];
    const nextValue = safeRuntimeCount(currentValue, INITIAL_HAND_COUNTS[element]);
    nextHand[element] = nextValue;

    if (!hand || typeof hand !== "object" || Array.isArray(hand) || nextValue !== currentValue) {
      repaired = true;
    }
  }

  if (repaired) {
    logger?.warn?.("[RuntimeGuard] repaired malformed hand state");
  }

  return {
    value: repaired ? nextHand : hand,
    repaired
  };
}

// WAR state accumulates cards between rounds, so repair only the invalid parts
// of the live WAR container rather than wiping the whole room.
export function guardRuntimeWarState(warState, logger = console) {
  const nextWarPotHost = Array.isArray(warState?.warPot?.host)
    ? warState.warPot.host.filter((card) => isValidElement(card))
    : [];
  const nextWarPotGuest = Array.isArray(warState?.warPot?.guest)
    ? warState.warPot.guest.filter((card) => isValidElement(card))
    : [];
  const nextWarRounds = Array.isArray(warState?.warRounds)
    ? warState.warRounds
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => ({ ...entry }))
    : [];
  const nextWarState = {
    warActive: Boolean(warState?.warActive),
    warDepth: safeRuntimeCount(warState?.warDepth, 0),
    warRounds: nextWarRounds,
    warPot: {
      host: nextWarPotHost,
      guest: nextWarPotGuest
    }
  };

  const repaired =
    !warState ||
    typeof warState !== "object" ||
    Array.isArray(warState) ||
    nextWarState.warActive !== warState?.warActive ||
    nextWarState.warDepth !== warState?.warDepth ||
    nextWarState.warRounds.length !== (Array.isArray(warState?.warRounds) ? warState.warRounds.length : 0) ||
    nextWarState.warPot.host.length !== (Array.isArray(warState?.warPot?.host) ? warState.warPot.host.length : 0) ||
    nextWarState.warPot.guest.length !== (Array.isArray(warState?.warPot?.guest) ? warState.warPot.guest.length : 0);

  if (repaired) {
    logger?.warn?.("[RuntimeGuard] repaired malformed war state");
  }

  return {
    value: repaired ? nextWarState : warState,
    repaired
  };
}

// Round payloads feed existing outcome/WAR resolution. Rebuild only malformed
// round payloads from the authoritative room move state so valid rounds stay
// untouched.
export function guardRuntimeRoundPayload(room, roundPayload, logger = console) {
  const currentHostMove = isValidElement(room?.moves?.hostMove) ? room.moves.hostMove : null;
  const currentGuestMove = isValidElement(room?.moves?.guestMove) ? room.moves.guestMove : null;
  const hostMove =
    currentHostMove && roundPayload?.hostMove !== currentHostMove
      ? currentHostMove
      : isValidElement(roundPayload?.hostMove)
        ? roundPayload.hostMove
        : currentHostMove;
  const guestMove =
    currentGuestMove && roundPayload?.guestMove !== currentGuestMove
      ? currentGuestMove
      : isValidElement(roundPayload?.guestMove)
        ? roundPayload.guestMove
        : currentGuestMove;

  if (!hostMove || !guestMove) {
    if (roundPayload) {
      logger?.warn?.("[RuntimeGuard] repaired malformed round payload");
    }
    return {
      value: null,
      repaired: Boolean(roundPayload)
    };
  }

  const currentRoundNumber = Math.max(1, safeRuntimeCount(room?.roundNumber, 1));
  const payloadRoundNumber = safeRuntimeCount(roundPayload?.round, currentRoundNumber);
  const resolvedRoundNumber =
    payloadRoundNumber !== currentRoundNumber ? currentRoundNumber : payloadRoundNumber;
  const safeOutcome = determineOutcome(hostMove, guestMove);
  const payloadMatchesCurrentContext =
    payloadRoundNumber === currentRoundNumber &&
    roundPayload?.hostMove === hostMove &&
    roundPayload?.guestMove === guestMove;
  let safeOutcomeType = String(roundPayload?.outcomeType ?? "").trim();

  if (
    !payloadMatchesCurrentContext ||
    !["resolved", "war", "war_resolved", "no_effect"].includes(safeOutcomeType)
  ) {
    safeOutcomeType = room?.warActive
      ? safeOutcome.hostResult === "win" || safeOutcome.guestResult === "win"
        ? "war_resolved"
        : safeOutcome.hostResult === "war"
          ? "war"
          : "no_effect"
      : safeOutcome.hostResult === "war"
        ? "war"
        : safeOutcome.hostResult === "no_effect"
          ? "no_effect"
          : "resolved";
  }

  const nextRoundPayload = {
    roomCode: room?.roomCode ?? roundPayload?.roomCode ?? null,
    hostMove,
    guestMove,
    round: resolvedRoundNumber,
    outcomeType: safeOutcomeType,
    ...safeOutcome
  };

  const repaired =
    !roundPayload ||
    typeof roundPayload !== "object" ||
    Array.isArray(roundPayload) ||
    roundPayload.hostMove !== nextRoundPayload.hostMove ||
    roundPayload.guestMove !== nextRoundPayload.guestMove ||
    roundPayload.round !== nextRoundPayload.round ||
    roundPayload.outcomeType !== nextRoundPayload.outcomeType ||
    roundPayload.hostResult !== nextRoundPayload.hostResult ||
    roundPayload.guestResult !== nextRoundPayload.guestResult;

  if (repaired) {
    logger?.warn?.("[RuntimeGuard] repaired malformed round payload");
  }

  return {
    value: repaired ? nextRoundPayload : roundPayload,
    repaired
  };
}

// Match result snapshots must remain structurally safe before persistence or
// emit, but we only repair malformed counters/containers and keep valid data.
export function guardRuntimeMatchResultPayload(matchResult, logger = console) {
  if (!matchResult || typeof matchResult !== "object" || Array.isArray(matchResult)) {
    logger?.warn?.("[RuntimeGuard] repaired malformed match result payload");
    return {
      value: null,
      repaired: true
    };
  }

  const safeHostHand = guardRuntimeHandState(matchResult.hostHand, null).value ?? {
    ...INITIAL_HAND_COUNTS
  };
  const safeGuestHand = guardRuntimeHandState(matchResult.guestHand, null).value ?? {
    ...INITIAL_HAND_COUNTS
  };
  const safeWarState = guardRuntimeWarState(
    {
      warActive: matchResult.warActive,
      warDepth: matchResult.warDepth,
      warRounds: matchResult.warRounds,
      warPot: matchResult.warPot
    },
    null
  ).value;

  const nextMatchResult = {
    ...matchResult,
    round: safeRuntimeCount(matchResult.round, 0),
    roundNumber: safeRuntimeCount(matchResult.roundNumber, 1),
    hostScore: safeRuntimeCount(matchResult.hostScore, 0),
    guestScore: safeRuntimeCount(matchResult.guestScore, 0),
    hostHand: safeHostHand,
    guestHand: safeGuestHand,
    warPot: safeWarState.warPot,
    warActive: safeWarState.warActive,
    warDepth: safeWarState.warDepth,
    warRounds: safeWarState.warRounds
  };

  const repaired = JSON.stringify(nextMatchResult) !== JSON.stringify(matchResult);
  if (repaired) {
    logger?.warn?.("[RuntimeGuard] repaired malformed match result payload");
  }

  return {
    value: repaired ? nextMatchResult : matchResult,
    repaired
  };
}

// Existing round/WAR transitions mutate the room in place. Contain malformed
// containers and counters at those checkpoints so valid runtime state remains
// untouched while broken sections cannot leak into later transitions.
export function containRuntimeRoomState(
  room,
  {
    logger = console,
    logMessage = "[RuntimeInvariant] contained malformed post-round state"
  } = {}
) {
  const safeHostHand = guardRuntimeHandState(room?.hostHand, null).value ?? {
    ...INITIAL_HAND_COUNTS
  };
  const safeGuestHand = guardRuntimeHandState(room?.guestHand, null).value ?? {
    ...INITIAL_HAND_COUNTS
  };
  const safeWarState = guardRuntimeWarState(
    {
      warActive: room?.warActive,
      warDepth: room?.warDepth,
      warRounds: room?.warRounds,
      warPot: room?.warPot
    },
    null
  ).value ?? createInitialWarState();
  const nextMoves = {
    hostMove: isValidElement(room?.moves?.hostMove) ? room.moves.hostMove : null,
    guestMove: isValidElement(room?.moves?.guestMove) ? room.moves.guestMove : null
  };
  const nextHostScore = safeRuntimeCount(room?.hostScore, 0);
  const nextGuestScore = safeRuntimeCount(room?.guestScore, 0);
  const nextRoundNumber = Math.max(1, safeRuntimeCount(room?.roundNumber, 1));
  const repaired =
    !room ||
    typeof room !== "object" ||
    Array.isArray(room) ||
    safeHostHand !== room.hostHand ||
    safeGuestHand !== room.guestHand ||
    safeWarState.warActive !== room.warActive ||
    safeWarState.warDepth !== room.warDepth ||
    safeWarState.warRounds !== room.warRounds ||
    safeWarState.warPot !== room.warPot ||
    nextMoves.hostMove !== room?.moves?.hostMove ||
    nextMoves.guestMove !== room?.moves?.guestMove ||
    nextHostScore !== room?.hostScore ||
    nextGuestScore !== room?.guestScore ||
    nextRoundNumber !== room?.roundNumber;

  if (repaired && room && typeof room === "object" && !Array.isArray(room)) {
    room.hostHand = safeHostHand;
    room.guestHand = safeGuestHand;
    room.warActive = safeWarState.warActive;
    room.warDepth = safeWarState.warDepth;
    room.warRounds = safeWarState.warRounds;
    room.warPot = safeWarState.warPot;
    room.hostScore = nextHostScore;
    room.guestScore = nextGuestScore;
    room.roundNumber = nextRoundNumber;
    room.moves = {
      hostMove: nextMoves.hostMove,
      guestMove: nextMoves.guestMove,
      updatedAt: room.moves?.updatedAt ?? null
    };
  }

  if (repaired) {
    logger?.warn?.(logMessage);
  }

  return {
    value: room,
    repaired
  };
}

// Match summary payloads leave the live round system and feed emit/persistence
// paths. Contain malformed summary state at that final boundary only.
export function containRuntimeMatchSummaryState(matchResult, logger = console) {
  const guarded = guardRuntimeMatchResultPayload(matchResult, null);
  if (guarded.repaired) {
    logger?.warn?.("[RuntimeInvariant] contained malformed match summary state");
  }

  return guarded;
}

function buildPlayer(socket, payload = {}) {
  const username = normalizeUsername(payload.username);
  return {
    socketId: socket.id,
    connected: true,
    ...(username ? { username } : {}),
    equippedCosmetics: normalizeEquippedCosmetics(payload.equippedCosmetics),
    joinedAt: new Date().toISOString(),
    disconnectedAt: null
  };
}

function createEmptyMoveState() {
  return {
    hostMove: null,
    guestMove: null,
    updatedAt: null
  };
}

function createEmptyRoundResult() {
  return null;
}

function createInitialMatchState() {
  return {
    hostScore: 0,
    guestScore: 0,
    roundNumber: 1,
    lastOutcomeType: null,
    roundHistory: [],
    matchSequence: 1
  };
}

function createInitialWarState() {
  return {
    warActive: false,
    warDepth: 0,
    warRounds: [],
    warPot: {
      host: [],
      guest: []
    }
  };
}

function createInitialMatchCompletionState() {
  return {
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: {
      hostReady: false,
      guestReady: false
    }
  };
}

function createInitialRewardSettlementState() {
  return {
    rewardSettlement: {
      granted: false,
      grantedAt: null,
      summary: null
    }
  };
}

function createInitialDisconnectState() {
  return {
    disconnectState: {
      active: false,
      disconnectedRole: null,
      disconnectedUsername: null,
      remainingUsername: null,
      reason: null,
      expiresAt: null,
      resumedAt: null
    },
    closingAt: null
  };
}

function createInitialHandState() {
  return {
    hostHand: { ...INITIAL_HAND_COUNTS },
    guestHand: { ...INITIAL_HAND_COUNTS }
  };
}

function cloneMoveState(room) {
  const hostSubmitted = room.moves.hostMove !== null;
  const guestSubmitted = room.moves.guestMove !== null;
  const submittedCount = Number(hostSubmitted) + Number(guestSubmitted);

  return {
    hostSubmitted,
    guestSubmitted,
    submittedCount,
    bothSubmitted: hostSubmitted && guestSubmitted,
    updatedAt: room.moves.updatedAt
  };
}

function resetMoveState(room) {
  const guards = getRuntimeEdgeGuards(room);
  room.moves = createEmptyMoveState();
  room.latestRoundResult = createEmptyRoundResult();
  guards.lastAppliedRoundSignature = null;
}

function resetHandState(room) {
  room.hostHand = { ...INITIAL_HAND_COUNTS };
  room.guestHand = { ...INITIAL_HAND_COUNTS };
}

function resetWarState(room) {
  room.warActive = false;
  room.warDepth = 0;
  room.warRounds = [];
  room.warPot = {
    host: [],
    guest: []
  };
}

function resetRematchState(room) {
  room.rematch = {
    hostReady: false,
    guestReady: false
  };
}

function resetMatchState(room) {
  const guards = getRuntimeEdgeGuards(room);
  room.hostScore = 0;
  room.guestScore = 0;
  room.roundNumber = 1;
  room.lastOutcomeType = null;
  room.roundHistory = [];
  room.matchSequence = Math.max(1, Number(room.matchSequence ?? 1) + 1);
  room.matchComplete = false;
  room.winner = null;
  room.winReason = null;
  room.rewardSettlement = {
    granted: false,
    grantedAt: null,
    summary: null
  };
  room.disconnectState = {
    active: false,
    disconnectedRole: null,
    disconnectedUsername: null,
    remainingUsername: null,
    reason: null,
    expiresAt: null,
    resumedAt: null
  };
  room.closingAt = null;
  resetRematchState(room);
  resetWarState(room);
  resetHandState(room);
  resetMoveState(room);
  guards.lastCompletionSignature = null;
}

function markPlayerDisconnected(player) {
  if (!player) {
    return;
  }

  player.connected = false;
  player.disconnectedAt = new Date().toISOString();
}

function markPlayerConnected(player, socket) {
  if (!player || !socket) {
    return;
  }

  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = null;
}

function clearDisconnectState(room, { resumedAt = null } = {}) {
  room.disconnectState = {
    active: false,
    disconnectedRole: null,
    disconnectedUsername: null,
    remainingUsername: null,
    reason: resumedAt ? "match_resumed" : null,
    expiresAt: null,
    resumedAt
  };
}

function closeRoom(room, {
  disconnectedRole = null,
  disconnectedUsername = null,
  remainingUsername = null,
  reason = "room_closing",
  closingAt = null
} = {}) {
  room.status = "closing";
  room.closingAt = closingAt ?? room.closingAt ?? null;
  room.disconnectState = {
    active: true,
    disconnectedRole,
    disconnectedUsername,
    remainingUsername,
    reason,
    expiresAt: room.disconnectState?.expiresAt ?? null,
    resumedAt: room.disconnectState?.resumedAt ?? null
  };
  resetMoveState(room);
  resetRematchState(room);
}

function pauseRoomForReconnect(room, {
  disconnectedRole = null,
  disconnectedUsername = null,
  remainingUsername = null,
  expiresAt = null
} = {}) {
  room.status = "paused";
  room.disconnectState = {
    active: true,
    disconnectedRole,
    disconnectedUsername,
    remainingUsername,
    reason: "waiting_for_reconnect",
    expiresAt,
    resumedAt: null
  };
  resetRematchState(room);
}

function expireRoomAsNoContest(room) {
  room.status = "expired";
  room.matchComplete = false;
  room.winner = null;
  room.winReason = null;
  resetRematchState(room);
  room.disconnectState = {
    active: true,
    disconnectedRole: room.disconnectState?.disconnectedRole ?? null,
    disconnectedUsername: room.disconnectState?.disconnectedUsername ?? null,
    remainingUsername: room.disconnectState?.remainingUsername ?? null,
    reason: "disconnect_timeout_expired",
    expiresAt: room.disconnectState?.expiresAt ?? null,
    resumedAt: room.disconnectState?.resumedAt ?? null
  };
}

function cloneRewardSettlement(room) {
  if (
    !room.rewardSettlement?.granted &&
    !room.rewardSettlement?.grantedAt &&
    !room.rewardSettlement?.summary
  ) {
    return null;
  }

  return {
    granted: Boolean(room.rewardSettlement?.granted),
    grantedAt: room.rewardSettlement?.grantedAt ?? null,
    summary: room.rewardSettlement?.summary
      ? {
          granted: Boolean(room.rewardSettlement.summary.granted),
          winner: room.rewardSettlement.summary.winner ?? null,
          settledHostUsername: room.rewardSettlement.summary.settledHostUsername ?? null,
          settledGuestUsername: room.rewardSettlement.summary.settledGuestUsername ?? null,
          hostRewards: { ...(room.rewardSettlement.summary.hostRewards ?? {}) },
          guestRewards: { ...(room.rewardSettlement.summary.guestRewards ?? {}) }
        }
      : null
  };
}

export function determineOutcome(hostMove, guestMove) {
  if (hostMove === guestMove) {
    return {
      hostResult: "war",
      guestResult: "war"
    };
  }

  const hostWins =
    (hostMove === "fire" && guestMove === "earth") ||
    (hostMove === "earth" && guestMove === "wind") ||
    (hostMove === "wind" && guestMove === "water") ||
    (hostMove === "water" && guestMove === "fire");

  const guestWins =
    (guestMove === "fire" && hostMove === "earth") ||
    (guestMove === "earth" && hostMove === "wind") ||
    (guestMove === "wind" && hostMove === "water") ||
    (guestMove === "water" && hostMove === "fire");

  if (!hostWins && !guestWins) {
    return {
      hostResult: "no_effect",
      guestResult: "no_effect"
    };
  }

  return hostWins
    ? {
        hostResult: "win",
        guestResult: "lose"
      }
    : guestWins
      ? {
        hostResult: "lose",
        guestResult: "win"
        }
      : {
          hostResult: "no_effect",
          guestResult: "no_effect"
        };
}

function buildRoundApplicationSignature(room, roundPayload) {
  return [
    room?.roomCode ?? "",
    safeRuntimeCount(room?.matchSequence, 1),
    safeRuntimeCount(room?.roundNumber, 1),
    roundPayload?.hostMove ?? "",
    roundPayload?.guestMove ?? "",
    room?.warActive ? "war" : "normal",
    safeRuntimeCount(room?.warDepth, 0)
  ].join("|");
}

function buildCompletionSignature(room) {
  return [
    room?.roomCode ?? "",
    safeRuntimeCount(room?.matchSequence, 1),
    safeRuntimeCount(room?.roundNumber, 1),
    room?.winner ?? "",
    room?.winReason ?? "",
    safeRuntimeCount(room?.hostScore, 0),
    safeRuntimeCount(room?.guestScore, 0),
    getTotalOwnedCards(room?.hostHand, room?.warPot?.host),
    getTotalOwnedCards(room?.guestHand, room?.warPot?.guest),
    room?.warActive ? "war" : "normal"
  ].join("|");
}

function appendWarRound(room, entry) {
  room.warRounds.push(entry);
  while (room.warRounds.length > 10) {
    room.warRounds.shift();
  }
}

function addElementToHand(hand, element, count = 1) {
  if (!hand || !Object.hasOwn(INITIAL_HAND_COUNTS, element)) {
    return;
  }

  hand[element] = Number(hand[element] ?? 0) + count;
}

export function getTotalCardsInHand(hand) {
  return Object.values(hand ?? {}).reduce((total, count) => total + Number(count ?? 0), 0);
}

export function getTotalOwnedCards(hand, committedCards = []) {
  return getTotalCardsInHand(hand) + (Array.isArray(committedCards) ? committedCards.length : 0);
}

function appendWarPot(room, hostMove, guestMove) {
  room.warPot.host.push(hostMove);
  room.warPot.guest.push(guestMove);
}

function awardResolvedRoundCards(room, roundResult) {
  if (roundResult.hostResult === "win") {
    addElementToHand(room.hostHand, roundResult.hostMove);
    addElementToHand(room.hostHand, roundResult.guestMove);
  } else if (roundResult.guestResult === "win") {
    addElementToHand(room.guestHand, roundResult.guestMove);
    addElementToHand(room.guestHand, roundResult.hostMove);
  } else {
    addElementToHand(room.hostHand, roundResult.hostMove);
    addElementToHand(room.guestHand, roundResult.guestMove);
  }
}

function awardWarPot(room, roundResult) {
  if (roundResult.hostResult === "win") {
    for (const card of room.warPot.host) {
      addElementToHand(room.hostHand, card);
    }
    for (const card of room.warPot.guest) {
      addElementToHand(room.hostHand, card);
    }
  } else if (roundResult.guestResult === "win") {
    for (const card of room.warPot.guest) {
      addElementToHand(room.guestHand, card);
    }
    for (const card of room.warPot.host) {
      addElementToHand(room.guestHand, card);
    }
  }

  room.warPot = {
    host: [],
    guest: []
  };
}

function completeMatchFromExhaustion(room, winner) {
  room.matchComplete = true;
  room.winner = winner;
  room.winReason = "hand_exhaustion";
  resetRematchState(room);
}

function clearMatchCompletion(room) {
  room.matchComplete = false;
  room.winner = null;
  room.winReason = null;
}

export function updateMatchCompletion(room) {
  const guards = getRuntimeEdgeGuards(room);
  containRuntimeRoomState(room, {
    logMessage: "[RuntimeInvariant] contained malformed post-round state"
  });

  const hostOwnedCards = getTotalOwnedCards(room.hostHand, room.warPot?.host);
  const guestOwnedCards = getTotalOwnedCards(room.guestHand, room.warPot?.guest);

  if (hostOwnedCards === 0 && guestOwnedCards === 0) {
    const completionSignature = buildCompletionSignature({
      ...room,
      winner: "draw",
      winReason: "hand_exhaustion"
    });
    if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
      console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
      return true;
    }
    completeMatchFromExhaustion(room, "draw");
    guards.lastCompletionSignature = completionSignature;
    return true;
  }

  if (hostOwnedCards === 0 && guestOwnedCards > 0) {
    const completionSignature = buildCompletionSignature({
      ...room,
      winner: "guest",
      winReason: "hand_exhaustion"
    });
    if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
      console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
      return true;
    }
    completeMatchFromExhaustion(room, "guest");
    guards.lastCompletionSignature = completionSignature;
    return true;
  }

  if (guestOwnedCards === 0 && hostOwnedCards > 0) {
    const completionSignature = buildCompletionSignature({
      ...room,
      winner: "host",
      winReason: "hand_exhaustion"
    });
    if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
      console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
      return true;
    }
    completeMatchFromExhaustion(room, "host");
    guards.lastCompletionSignature = completionSignature;
    return true;
  }

  if (room.warActive) {
    const hostLegalMoves = getTotalCardsInHand(room.hostHand);
    const guestLegalMoves = getTotalCardsInHand(room.guestHand);

    if (hostLegalMoves === 0 && guestLegalMoves === 0) {
      const completionSignature = buildCompletionSignature({
        ...room,
        winner: "draw",
        winReason: "hand_exhaustion"
      });
      if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
        return true;
      }
      completeMatchFromExhaustion(room, "draw");
      guards.lastCompletionSignature = completionSignature;
      return true;
    }

    if (hostLegalMoves === 0 && guestLegalMoves > 0) {
      const completionSignature = buildCompletionSignature({
        ...room,
        winner: "guest",
        winReason: "hand_exhaustion"
      });
      if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
        return true;
      }
      completeMatchFromExhaustion(room, "guest");
      guards.lastCompletionSignature = completionSignature;
      return true;
    }

    if (guestLegalMoves === 0 && hostLegalMoves > 0) {
      const completionSignature = buildCompletionSignature({
        ...room,
        winner: "host",
        winReason: "hand_exhaustion"
      });
      if (room.matchComplete && guards.lastCompletionSignature === completionSignature) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate match completion");
        return true;
      }
      completeMatchFromExhaustion(room, "host");
      guards.lastCompletionSignature = completionSignature;
      return true;
    }
  }

  guards.lastCompletionSignature = null;
  clearMatchCompletion(room);
  return false;
}

export function buildRoundResult(room) {
  if (!room.moves.hostMove || !room.moves.guestMove) {
    return null;
  }

  const resolvedRoundNumber = room.roundNumber;
  const outcome = determineOutcome(room.moves.hostMove, room.moves.guestMove);
  let outcomeType = "resolved";

  if (room.warActive) {
    if (outcome.hostResult === "win" || outcome.guestResult === "win") {
      outcomeType = "war_resolved";
    } else if (outcome.hostResult === "war") {
      outcomeType = "war";
    } else {
      outcomeType = "no_effect";
    }
  } else if (outcome.hostResult === "war") {
    outcomeType = "war";
  } else if (outcome.hostResult === "no_effect") {
    outcomeType = "no_effect";
  }

  return {
    roomCode: room.roomCode,
    hostMove: room.moves.hostMove,
    guestMove: room.moves.guestMove,
    round: resolvedRoundNumber,
    outcomeType,
    ...outcome
  };
}

export function applyRoundToMatchState(room, roundResult) {
  const guards = getRuntimeEdgeGuards(room);
  containRuntimeRoomState(room, {
    logMessage: "[RuntimeInvariant] contained malformed pre-round state"
  });

  if (
    room.latestRoundResult &&
    room.moves?.hostMove &&
    room.moves?.guestMove &&
    room.latestRoundResult.hostMove === room.moves.hostMove &&
    room.latestRoundResult.guestMove === room.moves.guestMove &&
    safeRuntimeCount(room.latestRoundResult.round, 0) < safeRuntimeCount(room.roundNumber, 1)
  ) {
    console.warn("[RuntimeEdgeGuard] skipped duplicate round application");
    return room.latestRoundResult;
  }

  const guardedRound = guardRuntimeRoundPayload(room, roundResult).value;
  if (!guardedRound) {
    return null;
  }

  const stalePayloadDetected =
    roundResult &&
    typeof roundResult === "object" &&
    !Array.isArray(roundResult) &&
    (
      safeRuntimeCount(roundResult.round, room.roundNumber) !== room.roundNumber ||
      roundResult.hostMove !== guardedRound.hostMove ||
      roundResult.guestMove !== guardedRound.guestMove
    );
  if (stalePayloadDetected) {
    console.warn("[RuntimeEdgeGuard] contained stale runtime payload");
  }

  const roundSignature = buildRoundApplicationSignature(room, guardedRound);
  if (guards.lastAppliedRoundSignature === roundSignature) {
    console.warn("[RuntimeEdgeGuard] skipped duplicate round application");
    return room.latestRoundResult ?? null;
  }

  const resolvedRoundNumber = room.roundNumber;
  const outcomeType = guardedRound.outcomeType ?? null;

  if (outcomeType === "war") {
    appendWarPot(room, guardedRound.hostMove, guardedRound.guestMove);
    if (!room.warActive) {
      room.warActive = true;
      room.warDepth = 1;
      room.warRounds = [];
    } else {
      room.warDepth += 1;
    }

    appendWarRound(room, {
      round: resolvedRoundNumber,
      hostMove: guardedRound.hostMove,
      guestMove: guardedRound.guestMove,
      outcomeType
    });
    containRuntimeRoomState(room, {
      logMessage: "[RuntimeInvariant] contained malformed war transition state"
    });
  } else if (room.warActive && outcomeType === "no_effect") {
    appendWarPot(room, guardedRound.hostMove, guardedRound.guestMove);
    appendWarRound(room, {
      round: resolvedRoundNumber,
      hostMove: guardedRound.hostMove,
      guestMove: guardedRound.guestMove,
      outcomeType
    });
    containRuntimeRoomState(room, {
      logMessage: "[RuntimeInvariant] contained malformed war transition state"
    });
  } else if (room.warActive && outcomeType === "war_resolved") {
    appendWarPot(room, guardedRound.hostMove, guardedRound.guestMove);
    appendWarRound(room, {
      round: resolvedRoundNumber,
      hostMove: guardedRound.hostMove,
      guestMove: guardedRound.guestMove,
      outcomeType
    });
    containRuntimeRoomState(room, {
      logMessage: "[RuntimeInvariant] contained malformed war transition state"
    });
  }

  if (outcomeType === "resolved") {
    awardResolvedRoundCards(room, guardedRound);
  } else if (outcomeType === "no_effect" && !room.warActive) {
    awardResolvedRoundCards(room, guardedRound);
  } else if (outcomeType === "war_resolved") {
    awardWarPot(room, guardedRound);
  }

  if (outcomeType === "resolved" || outcomeType === "war_resolved") {
    if (guardedRound.hostResult === "win") {
      room.hostScore += 1;
    }

    if (guardedRound.guestResult === "win") {
      room.guestScore += 1;
    }
  }

  room.lastOutcomeType = outcomeType;
  room.roundHistory.push({
    round: resolvedRoundNumber,
    hostMove: guardedRound.hostMove,
    guestMove: guardedRound.guestMove,
    outcomeType,
    hostResult: guardedRound.hostResult,
    guestResult: guardedRound.guestResult
  });

  containRuntimeRoomState(room, {
    logMessage: "[RuntimeInvariant] contained malformed post-round state"
  });

  while (room.roundHistory.length > 10) {
    room.roundHistory.shift();
  }

  room.roundNumber = resolvedRoundNumber + 1;

  const safeMatchResult = containRuntimeMatchSummaryState({
    ...guardedRound,
    hostScore: room.hostScore,
    guestScore: room.guestScore,
    roundNumber: room.roundNumber,
    lastOutcomeType: room.lastOutcomeType,
    matchComplete: room.matchComplete,
    winner: room.winner,
    winReason: room.winReason,
    rematch: { ...room.rematch },
    hostHand: { ...room.hostHand },
    guestHand: { ...room.guestHand },
    warPot: {
      host: [...room.warPot.host],
      guest: [...room.warPot.guest]
    },
    warActive: room.warActive,
    warDepth: room.warDepth,
    warRounds: room.warRounds.map((entry) => ({ ...entry }))
  }).value;

  guards.lastAppliedRoundSignature = roundSignature;

  return safeMatchResult;
}

function cloneRoom(room) {
  const rewardSettlement = cloneRewardSettlement(room);
  return {
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    host: room.host ? { ...room.host } : null,
    guest: room.guest ? { ...room.guest } : null,
    status: room.status,
    closingAt: room.closingAt ?? null,
    disconnectState: {
      active: Boolean(room.disconnectState?.active),
      disconnectedRole: room.disconnectState?.disconnectedRole ?? null,
      disconnectedUsername: room.disconnectState?.disconnectedUsername ?? null,
      remainingUsername: room.disconnectState?.remainingUsername ?? null,
      reason: room.disconnectState?.reason ?? null,
      expiresAt: room.disconnectState?.expiresAt ?? null,
      resumedAt: room.disconnectState?.resumedAt ?? null
    },
    hostScore: room.hostScore,
    guestScore: room.guestScore,
    roundNumber: room.roundNumber,
    lastOutcomeType: room.lastOutcomeType,
    matchComplete: Boolean(room.matchComplete),
    winner: room.winner ?? null,
    winReason: room.winReason ?? null,
    rematch: {
      hostReady: Boolean(room.rematch?.hostReady),
      guestReady: Boolean(room.rematch?.guestReady)
    },
    ...(rewardSettlement ? { rewardSettlement } : {}),
    hostHand: { ...room.hostHand },
    guestHand: { ...room.guestHand },
    warPot: {
      host: Array.isArray(room.warPot?.host) ? [...room.warPot.host] : [],
      guest: Array.isArray(room.warPot?.guest) ? [...room.warPot.guest] : []
    },
    warActive: room.warActive,
    warDepth: room.warDepth,
    warRounds: room.warRounds.map((entry) => ({ ...entry })),
    roundHistory: room.roundHistory.map((entry) => ({ ...entry })),
    moveSync: cloneMoveState(room)
  };
}

export function createRoomStore({ random = Math.random } = {}) {
  const rooms = new Map();
  const socketToRoom = new Map();

  function generateUniqueRoomCode() {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const roomCode = generateRoomCode(random);
      if (!rooms.has(roomCode)) {
        return roomCode;
      }
    }

    throw new Error("Unable to generate a unique room code.");
  }

  function getRoomBySocket(socketId) {
    const roomCode = socketToRoom.get(socketId);
    return roomCode ? rooms.get(roomCode) ?? null : null;
  }

  return {
    createRoom(socket, payload = {}) {
      if (getRoomBySocket(socket.id)) {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_JOINED",
            message: "This socket is already assigned to a room."
          }
        };
      }

      const roomCode = generateUniqueRoomCode();
      const room = {
        roomCode,
        createdAt: new Date().toISOString(),
        host: buildPlayer(socket, payload),
        guest: null,
        status: "waiting",
        ...createInitialMatchState(),
        ...createInitialMatchCompletionState(),
        ...createInitialRewardSettlementState(),
        ...createInitialDisconnectState(),
        ...createInitialHandState(),
        ...createInitialWarState(),
        moves: createEmptyMoveState(),
        latestRoundResult: createEmptyRoundResult()
      };

      rooms.set(roomCode, room);
      socketToRoom.set(socket.id, roomCode);

      return {
        ok: true,
        room: cloneRoom(room)
      };
    },

    joinRoom(socket, roomCodeInput, payload = {}) {
      if (getRoomBySocket(socket.id)) {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_JOINED",
            message: "This socket is already assigned to a room."
          }
        };
      }

      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);

      if (!room) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room code not found."
          }
        };
      }

      const username = normalizeUsername(payload.username);

      if (room.status === "paused") {
        const disconnectedRole = room.disconnectState?.disconnectedRole ?? null;
        const disconnectedUsername = room.disconnectState?.disconnectedUsername ?? null;
        const reconnectPlayer =
          disconnectedRole === "host"
            ? room.host
            : disconnectedRole === "guest"
              ? room.guest
              : null;

        if (!username || !disconnectedUsername || username !== disconnectedUsername || !reconnectPlayer) {
          return {
            ok: false,
            error: {
              code: "ROOM_RECONNECT_RESERVED",
              message: "This room is reserved for the disconnected player to resume."
            }
          };
        }

        markPlayerConnected(reconnectPlayer, socket);
        room.status = "full";
        clearDisconnectState(room, { resumedAt: new Date().toISOString() });
        socketToRoom.set(socket.id, roomCode);

        return {
          ok: true,
          room: cloneRoom(room),
          reconnected: true
        };
      }

      if (room.status === "expired") {
        return {
          ok: false,
          error: {
            code: "ROOM_EXPIRED",
            message: "This room has expired and can no longer be resumed."
          }
        };
      }

      if (room.status === "closing") {
        return {
          ok: false,
          error: {
            code: "ROOM_CLOSING",
            message: "This room is closing and cannot accept reconnects or new joins."
          }
        };
      }

      if (room.guest) {
        return {
          ok: false,
          error: {
            code: "ROOM_FULL",
            message: "Room is already full."
          }
        };
      }

      room.guest = buildPlayer(socket, { ...payload, username });
      room.status = "full";
      resetMoveState(room);
      resetRematchState(room);
      socketToRoom.set(socket.id, roomCode);

      return {
        ok: true,
        room: cloneRoom(room)
      };
    },

    removeSocket(socketId) {
      const roomCode = socketToRoom.get(socketId);
      if (!roomCode) {
        return { removedRoomCode: null, room: null };
      }

      socketToRoom.delete(socketId);
      const room = rooms.get(roomCode);
      if (!room) {
        return { removedRoomCode: roomCode, room: null };
      }

      const activeMatchInProgress =
        room.status === "full" &&
        !room.matchComplete &&
        (
          (Array.isArray(room.roundHistory) && room.roundHistory.length > 0) ||
          room.moves?.hostMove !== null ||
          room.moves?.guestMove !== null ||
          Number(room.roundNumber ?? 1) > 1
        );

      const buildPausedResult = (disconnectedRole) => {
        const disconnectedPlayer = disconnectedRole === "host" ? room.host : room.guest;
        const remainingPlayer = disconnectedRole === "host" ? room.guest : room.host;

        markPlayerDisconnected(disconnectedPlayer);
        pauseRoomForReconnect(room, {
          disconnectedRole,
          disconnectedUsername: disconnectedPlayer?.username ?? null,
          remainingUsername: remainingPlayer?.username ?? null,
        });

        return {
          removedRoomCode: null,
          room: cloneRoom(room),
          shouldScheduleReconnectExpiry: true
        };
      };

      const buildExpiredResult = ({
        disconnectedRole,
        disconnectedUsername,
        remainingUsername
      }) => {
        expireRoomAsNoContest(room);
        room.disconnectState = {
          ...room.disconnectState,
          disconnectedRole,
          disconnectedUsername,
          remainingUsername
        };

        return {
          removedRoomCode: null,
          room: cloneRoom(room),
          shouldScheduleCleanup: true
        };
      };

      if (room.host?.socketId === socketId) {
        if (room.status === "paused") {
          const guestConnected = Boolean(room.guest?.connected);
          markPlayerDisconnected(room.host);
          if (!guestConnected) {
            return buildExpiredResult({
              disconnectedRole: room.disconnectState?.disconnectedRole ?? "host",
              disconnectedUsername: room.disconnectState?.disconnectedUsername ?? room.host?.username ?? null,
              remainingUsername: null
            });
          }
        }

        if (activeMatchInProgress) {
          return buildPausedResult("host");
        }

        if (room.matchComplete) {
          markPlayerDisconnected(room.host);
          closeRoom(room, {
            disconnectedRole: "host",
            disconnectedUsername: room.host?.username ?? null,
            remainingUsername: room.guest?.username ?? null,
            reason: "post_match_disconnect"
          });
          return {
            removedRoomCode: null,
            room: cloneRoom(room),
            shouldScheduleCleanup: true
          };
        }

        if (room.guest) {
          room.host = room.guest;
          room.guest = null;
          room.status = "waiting";
          room.disconnectState = {
            active: false,
            disconnectedRole: null,
            disconnectedUsername: null,
            remainingUsername: null,
            reason: null,
            expiresAt: null,
            resumedAt: null
          };
          room.closingAt = null;
          resetMoveState(room);
          return {
            removedRoomCode: null,
            room: cloneRoom(room)
          };
        }

        rooms.delete(roomCode);
        return {
          removedRoomCode: roomCode,
          room: null
        };
      }

      if (room.guest?.socketId === socketId) {
        if (room.status === "paused") {
          const hostConnected = Boolean(room.host?.connected);
          markPlayerDisconnected(room.guest);
          if (!hostConnected) {
            return buildExpiredResult({
              disconnectedRole: room.disconnectState?.disconnectedRole ?? "guest",
              disconnectedUsername: room.disconnectState?.disconnectedUsername ?? room.guest?.username ?? null,
              remainingUsername: null
            });
          }
        }

        if (activeMatchInProgress) {
          return buildPausedResult("guest");
        }

        if (room.matchComplete) {
          markPlayerDisconnected(room.guest);
          closeRoom(room, {
            disconnectedRole: "guest",
            disconnectedUsername: room.guest?.username ?? null,
            remainingUsername: room.host?.username ?? null,
            reason: "post_match_disconnect"
          });
          return {
            removedRoomCode: null,
            room: cloneRoom(room),
            shouldScheduleCleanup: true
          };
        }

        room.guest = null;
        room.status = "waiting";
        room.disconnectState = {
          active: false,
          disconnectedRole: null,
          disconnectedUsername: null,
          remainingUsername: null,
          reason: null,
          expiresAt: null,
          resumedAt: null
        };
        room.closingAt = null;
        resetMoveState(room);
      }

      if (!room.host && !room.guest) {
        rooms.delete(roomCode);
        return {
          removedRoomCode: roomCode,
          room: null
        };
      }

      return {
        removedRoomCode: null,
        room: cloneRoom(room)
      };
    },

    getRoom(roomCode) {
      const room = rooms.get(sanitizeRoomCode(roomCode));
      return room ? cloneRoom(room) : null;
    },

    submitMove(socketId, moveInput) {
      const room = getRoomBySocket(socketId);
      if (!room) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room code not found."
          }
        };
      }

      if (room.status !== "full" || !room.host || !room.guest) {
        if (room.status === "paused") {
          return {
            ok: false,
            error: {
              code: "ROOM_PAUSED",
              message: "Match is paused while waiting for a player to reconnect."
            }
          };
        }

        if (room.status === "expired") {
          return {
            ok: false,
            error: {
              code: "ROOM_EXPIRED",
              message: "This room has expired and can no longer be played."
            }
          };
        }

        return {
          ok: false,
          error: {
            code: "ROOM_NOT_READY",
            message: "Both players must be connected before submitting moves."
          }
        };
      }

      if (!room.host.connected || !room.guest.connected) {
        return {
          ok: false,
          error: {
            code: "ROOM_CLOSING",
            message: "This room is closing and can no longer accept moves."
          }
        };
      }

      if (room.matchComplete) {
        return {
          ok: false,
          error: {
            code: "MATCH_COMPLETE",
            message: "Match is complete. Both players must ready a rematch first."
          }
        };
      }

      // Repair the live hand/WAR containers at the move boundary so legality
      // checks and round resolution never consume malformed runtime state.
      containRuntimeRoomState(room, {
        logMessage: "[RuntimeInvariant] contained malformed pre-round state"
      });

      const move = String(moveInput ?? "").trim().toLowerCase();
      if (!move) {
        return {
          ok: false,
          error: {
            code: "MOVE_INVALID",
            message: "Move selection is required."
          }
        };
      }

      if (!Object.hasOwn(INITIAL_HAND_COUNTS, move)) {
        return {
          ok: false,
          error: {
            code: "MOVE_INVALID",
            message: "Move selection is required."
          }
        };
      }

      const moveKey =
        room.host?.socketId === socketId
          ? "hostMove"
          : room.guest?.socketId === socketId
            ? "guestMove"
            : null;
      const handKey =
        moveKey === "hostMove"
          ? "hostHand"
          : moveKey === "guestMove"
            ? "guestHand"
            : null;

      if (!moveKey) {
        return {
          ok: false,
          error: {
            code: "ROOM_PLAYER_NOT_FOUND",
            message: "This socket is not assigned to a room player slot."
          }
        };
      }

      if (room.moves[moveKey] !== null) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate move application");
        return {
          ok: false,
          error: {
            code: "MOVE_ALREADY_SUBMITTED",
            message: "This player already submitted a move."
          }
        };
      }

      if (!handKey || Number(room[handKey]?.[move] ?? 0) <= 0) {
        return {
          ok: false,
          error: {
            code: "ILLEGAL_MOVE_NOT_IN_HAND",
            message: "That element is no longer available in this hand."
          }
        };
      }

      room[handKey][move] -= 1;
      room.moves[moveKey] = move;
      room.moves.updatedAt = new Date().toISOString();
      room.latestRoundResult = applyRoundToMatchState(room, buildRoundResult(room));
      if (room.latestRoundResult) {
        updateMatchCompletion(room);
      }
      if (room.latestRoundResult) {
        const rewardSettlement = cloneRewardSettlement(room);
        room.latestRoundResult = {
          ...room.latestRoundResult,
          matchComplete: room.matchComplete,
          winner: room.winner,
          winReason: room.winReason,
          rematch: { ...room.rematch },
          ...(rewardSettlement ? { rewardSettlement } : {})
        };
      }

      return {
        ok: true,
        room: cloneRoom(room),
        roundResult: room.latestRoundResult
      };
    },

    readyRematch(socketId) {
      const room = getRoomBySocket(socketId);
      if (!room) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room code not found."
          }
        };
      }

      if (!room.matchComplete) {
        return {
          ok: false,
          error: {
            code: "MATCH_NOT_COMPLETE",
            message: "Rematch is only available after a match ends."
          }
        };
      }

      if (room.status === "closing") {
        return {
          ok: false,
          error: {
            code: "REMATCH_UNAVAILABLE",
            message: "Rematch is unavailable because this room is closing."
          }
        };
      }

      if (room.host?.socketId === socketId) {
        room.rematch.hostReady = true;
      } else if (room.guest?.socketId === socketId) {
        room.rematch.guestReady = true;
      } else {
        return {
          ok: false,
          error: {
            code: "ROOM_PLAYER_NOT_FOUND",
            message: "This socket is not assigned to a room player slot."
          }
        };
      }

      const bothReady = room.rematch.hostReady && room.rematch.guestReady;
      if (bothReady) {
        resetMatchState(room);
      }

      return {
        ok: true,
        room: cloneRoom(room),
        rematchStarted: bothReady
      };
    },

    resetRound(roomCodeInput, { clearWarState = false } = {}) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return null;
      }

      resetMoveState(room);
      if (clearWarState) {
        resetWarState(room);
      }
      updateMatchCompletion(room);
      return cloneRoom(room);
    },

    getRoomCodeForSocket(socketId) {
      return socketToRoom.get(socketId) ?? null;
    },

    getCurrentMatchSettlementKey(roomCodeInput) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return null;
      }

      return `${room.roomCode}:match:${Math.max(1, Number(room.matchSequence ?? 1))}`;
    },

    setRewardSettlement(roomCodeInput, summary, grantedAt = new Date().toISOString()) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return null;
      }

      room.rewardSettlement = {
        granted: Boolean(summary),
        grantedAt: summary ? grantedAt : null,
        summary: summary
          ? {
              granted: Boolean(summary.granted),
              winner: summary.winner ?? null,
              settledHostUsername: summary.settledHostUsername ?? null,
              settledGuestUsername: summary.settledGuestUsername ?? null,
              hostRewards: { ...(summary.hostRewards ?? {}) },
              guestRewards: { ...(summary.guestRewards ?? {}) }
            }
          : null
      };

      if (room.latestRoundResult) {
        const rewardSettlement = cloneRewardSettlement(room);
        room.latestRoundResult = {
          ...room.latestRoundResult,
          ...(rewardSettlement ? { rewardSettlement } : {})
        };
      }

      return cloneRoom(room);
    },

    setClosingAt(roomCodeInput, closingAt) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return null;
      }

      room.closingAt = closingAt ?? null;
      return cloneRoom(room);
    },

    setDisconnectExpiresAt(roomCodeInput, expiresAt) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return null;
      }

      room.disconnectState = {
        ...room.disconnectState,
        expiresAt: expiresAt ?? null
      };
      return cloneRoom(room);
    },

    expireDisconnectedRoom(roomCodeInput) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room || room.status !== "paused") {
        return room ? cloneRoom(room) : null;
      }

      expireRoomAsNoContest(room);
      return cloneRoom(room);
    },

    removeRoom(roomCodeInput) {
      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);
      if (!room) {
        return false;
      }

      if (room.host?.socketId) {
        socketToRoom.delete(room.host.socketId);
      }
      if (room.guest?.socketId) {
        socketToRoom.delete(room.guest.socketId);
      }
      rooms.delete(roomCode);
      return true;
    }
  };
}
