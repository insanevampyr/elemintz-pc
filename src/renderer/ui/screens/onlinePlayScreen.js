import { getAvatarImage, getCardBackImage, getCardImage, getVariantCardImages } from "../../utils/assets.js";
import { getCosmeticDefinition } from "../../../state/cosmeticSystem.js";
import { escapeHtml } from "../../utils/dom.js";
import { formatElement } from "../../utils/index.js";
import {
  normalizeCosmeticRarity,
  rarityClassName,
  renderElementHandSummary,
  renderHiddenHandSummary,
  renderMatchTauntHud,
  renderPlayerHeader
} from "../shared/playSurfaceShared.js";
import { bindCosmeticHoverPreview } from "../shared/cosmeticHoverPreview.js";

const ELEMENT_ORDER = ["fire", "earth", "wind", "water"];
const DEFAULT_ONLINE_EQUIPPED_COSMETICS = Object.freeze({
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
let detachOnlineKeyboardHandler = null;

function findMoveButtonFromEvent(event) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    if (entry?.classList?.contains?.("online-move-btn")) {
      return entry;
    }
  }

  let node = event?.target ?? null;
  while (node) {
    if (node?.classList?.contains?.("online-move-btn")) {
      return node;
    }

    node = node.parentNode ?? node.parentElement ?? null;
  }

  return null;
}

function deriveRoleLabel(context) {
  const room = context.multiplayer?.room;
  const socketId = context.multiplayer?.socketId;

  if (!room || !socketId) {
    return null;
  }

  if (room.host?.socketId === socketId) {
    return "Host";
  }

  if (room.guest?.socketId === socketId) {
    return "Guest";
  }

  return null;
}

function deriveSettledRoleLabel(context) {
  const username = String(context.username ?? "").trim();
  const decision = context.multiplayer?.room?.rewardSettlement?.decision ?? null;
  const summary = context.multiplayer?.room?.rewardSettlement?.summary ?? null;
  const hostUsername = decision?.participants?.hostUsername ?? summary?.settledHostUsername ?? null;
  const guestUsername = decision?.participants?.guestUsername ?? summary?.settledGuestUsername ?? null;

  if (username && hostUsername === username) {
    return "Host";
  }

  if (username && guestUsername === username) {
    return "Guest";
  }

  return deriveRoleLabel(context);
}

function deriveMoveSyncView(context) {
  const room = context.multiplayer?.room;
  const roleLabel = deriveRoleLabel(context);
  const sync =
    room?.moveSync ??
    (room?.status === "full"
      ? {
          hostSubmitted: false,
          guestSubmitted: false,
          submittedCount: 0,
          bothSubmitted: false,
          updatedAt: null
        }
      : null);

  if (!room || room.status !== "full" || !sync) {
    return null;
  }

  const ownSubmitted =
    roleLabel === "Host"
      ? Boolean(sync.hostSubmitted)
      : roleLabel === "Guest"
        ? Boolean(sync.guestSubmitted)
        : false;

  return {
    submittedCount: Number(sync.submittedCount ?? 0),
    bothSubmitted: Boolean(sync.bothSubmitted),
    hostSubmitted: Boolean(sync.hostSubmitted),
    guestSubmitted: Boolean(sync.guestSubmitted),
    ownSubmitted
  };
}

function formatMoveLabel(move) {
  const normalized = String(move ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveBattleLogResultSource(context) {
  const persistedResult = context.multiplayer?.lastCompletedBattleResult ?? null;
  if (persistedResult) {
    return {
      authoritativeResult: null,
      result: persistedResult
    };
  }

  const authoritativeResult = context.multiplayer?.latestAuthoritativeRoundResult ?? null;
  const result = authoritativeResult?.roundResult ?? context.multiplayer?.latestRoundResult ?? null;

  return {
    authoritativeResult,
    result
  };
}

function deriveRoundResultView(context) {
  const { authoritativeResult, result } = resolveBattleLogResultSource(context);
  const roleLabel =
    result?.matchComplete || context.multiplayer?.room?.matchComplete
      ? deriveSettledRoleLabel(context)
      : deriveRoleLabel(context);

  if (!result || !roleLabel) {
    return null;
  }

  const perspectiveResult =
    roleLabel === "Host" ? result.hostResult : roleLabel === "Guest" ? result.guestResult : null;
  const perspectiveLabel =
    result.outcomeType === "war_resolved"
      ? perspectiveResult === "win"
        ? "WAR Won"
        : perspectiveResult === "lose"
          ? "WAR Lost"
          : ""
      : perspectiveResult === "win"
      ? "You Win"
      : perspectiveResult === "lose"
        ? "You Lose"
        : perspectiveResult === "war"
          ? "WAR Continues"
          : perspectiveResult === "no_effect"
            ? "No Effect"
          : "";

  if (!perspectiveLabel) {
    return null;
  }

  return {
    outcomeType: authoritativeResult?.outcomeType ?? result.outcomeType ?? null,
    hostMove: formatMoveLabel(authoritativeResult?.submittedCards?.host ?? result.hostMove),
    guestMove: formatMoveLabel(authoritativeResult?.submittedCards?.guest ?? result.guestMove),
    roundNumber: Number(result.roundNumber ?? 0) || null,
    perspectiveLabel
  };
}

function deriveSharedBattleResultView(context) {
  const roundResult = deriveRoundResultView(context);
  const room = context.multiplayer?.room ?? null;

  if (roundResult) {
    const hostMoveText = roundResult.hostMove || "Unknown";
    const guestMoveText = roundResult.guestMove || "Unknown";
    const outcomeType = String(roundResult.outcomeType ?? "").trim().toLowerCase();

    if (outcomeType === "war_resolved") {
      return {
        tone: "war",
        headline: roundResult.perspectiveLabel,
        why: `WAR resolved after Host played ${hostMoveText} and Guest played ${guestMoveText}.`,
        changed: "The WAR pile was awarded and the round score has been updated."
      };
    }

    if (outcomeType === "war") {
      return {
        tone: "war",
        headline: "WAR started",
        why: `Host played ${hostMoveText} and Guest played ${guestMoveText}, so neither side broke the tie.`,
        changed: "The tied cards rolled into WAR and both players must resolve the next clash."
      };
    }

    if (outcomeType === "no_effect" || roundResult.perspectiveLabel === "No Effect") {
      return {
        tone: "neutral",
        headline: "No Effect",
        why: `Host played ${hostMoveText} and Guest played ${guestMoveText}, so neither card overpowered the other.`,
        changed: "No cards changed sides and both players kept control of the round."
      };
    }

    return {
      tone: roundResult.perspectiveLabel === "You Lose" ? "loss" : "win",
      headline: `Round ${Math.max(1, Number(roundResult.roundNumber ?? room?.roundNumber ?? 1))} - ${roundResult.perspectiveLabel}`,
      why: `Host played ${hostMoveText} and Guest played ${guestMoveText}.`,
      changed: "The round result has been applied to the online match score and captured-card state."
    };
  }

  if (room?.warActive) {
    const warDepth = Math.max(1, Number(room?.warDepth ?? 1));
    return {
      tone: "war",
      headline: "WAR active",
      why: `The last clash stayed tied, so the match is still in WAR at depth ${warDepth}.`,
        changed: "The WAR pile is still contested and the next submitted moves will decide whether it continues or resolves."
    };
  }

  if (room?.status === "full") {
    return {
      tone: "placeholder",
      headline: "Battle log will appear here.",
      why: "",
      changed: ""
    };
  }

  return null;
}

function deriveMatchStatusView(context) {
  const room = context.multiplayer?.room;
  if (!room) {
    return null;
  }

  return {
    roundNumber: Number(room.roundNumber ?? 1),
    hostScore: Number(room.hostScore ?? 0),
    guestScore: Number(room.guestScore ?? 0),
    lastOutcomeType: room.lastOutcomeType ?? null
  };
}

function sumHandCount(hand = null) {
  if (!hand) {
    return 0;
  }

  return ELEMENT_ORDER.reduce((total, element) => total + Math.max(0, Number(hand?.[element] ?? 0)), 0);
}

function renderWaitingPreviewCards(identity, key) {
  if (!identity?.variantImages) {
    return "";
  }

  return `
    <div class="online-waiting-preview-grid">
      ${ELEMENT_ORDER.map((element) => `
        <article class="online-waiting-preview-card" data-online-player-variant="${escapeHtml(key)}:${element}">
          <img
            class="online-waiting-preview-art"
            src="${identity.variantImages[element]}"
            alt="${escapeHtml(identity.username)} ${escapeHtml(formatElement(element))} preview"
          />
          <p class="online-waiting-preview-label">${escapeHtml(formatElement(element))}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWaitingOpponentPlaceholder() {
  return `
    <div class="online-waiting-placeholder" data-online-waiting-placeholder="guest">
      <p class="online-waiting-placeholder-title">Waiting for Opponent</p>
      <p class="online-waiting-placeholder-copy">This player slot will fill when someone joins the room.</p>
    </div>
  `;
}

function deriveOnlineBoardView(context) {
  const room = context.multiplayer?.room;
  const roleLabel = deriveRoleLabel(context);
  const handStatus = deriveHandStatusView(context);
  const moveSync = deriveMoveSyncView(context);
  const playersView = derivePlayersView(context);

  if (!room || !handStatus || !playersView || !roleLabel) {
    return null;
  }

  const localKey = roleLabel === "Guest" ? "guest" : "host";
  const remoteKey = localKey === "host" ? "guest" : "host";
  const localIdentity = playersView[localKey];
  const remoteIdentity = playersView[remoteKey];
  const localHand = localKey === "host" ? handStatus.hostHand : handStatus.guestHand;
  const remoteHand = remoteKey === "host" ? handStatus.hostHand : handStatus.guestHand;

  if (!localIdentity || !remoteIdentity) {
    return null;
  }

  return {
    localIdentity,
    remoteIdentity,
    localHand,
    remoteHand,
    localCount: sumHandCount(localHand),
    remoteCount: sumHandCount(remoteHand),
    localVariantMap: localIdentity.variantImages ?? null,
    opponentCardVariants: room.opponentCardVariants ?? null,
    remoteCardBack: remoteIdentity.cardBackImage ?? null,
    selectable: room.status === "full" && !room.matchComplete && Boolean(moveSync) && !moveSync.ownSubmitted,
    ownSubmitted: Boolean(moveSync?.ownSubmitted)
  };
}

function toPlayerDisplay(identity, fallbackName = "Player") {
  return {
    name: identity?.username ?? fallbackName,
    avatarId: identity?.avatarId ?? DEFAULT_ONLINE_EQUIPPED_COSMETICS.avatar,
    titleId: identity?.titleId ?? null,
    badgeId: identity?.badgeId ?? null,
    title: identity?.titleLabel ?? "Initiate",
    titleIcon: identity?.titleIcon ?? null,
    featuredBadge: identity?.badgeImage ?? null,
    avatar: identity?.avatarImage ?? getAvatarImage(DEFAULT_ONLINE_EQUIPPED_COSMETICS.avatar)
  };
}

function createWaitingOpponentIdentity(backgroundImage) {
  return {
    username: "Waiting...",
    avatarId: DEFAULT_ONLINE_EQUIPPED_COSMETICS.avatar,
    titleId: null,
    badgeId: null,
    titleLabel: "Opponent",
    titleIcon: null,
    badgeImage: null,
    avatarImage: getAvatarImage(DEFAULT_ONLINE_EQUIPPED_COSMETICS.avatar),
    backgroundImage: backgroundImage ?? "",
    cardBackImage: getCardBackImage(DEFAULT_ONLINE_EQUIPPED_COSMETICS.cardBack),
    variantImages: getVariantCardImages(DEFAULT_ONLINE_EQUIPPED_COSMETICS.elementCardVariant)
  };
}

function getVariantRarityMap(selection = null) {
  return Object.fromEntries(
    ELEMENT_ORDER.map((element) => [
      element,
      normalizeCosmeticRarity(
        getCosmeticDefinition("elementCardVariant", selection?.[element])?.rarity ?? "Common"
      )
    ])
  );
}

function getCardBackRarity(cardBackId) {
  return normalizeCosmeticRarity(getCosmeticDefinition("cardBack", cardBackId)?.rarity ?? "Common");
}

function renderOnlineOpponentVariantTracker(opponentCardVariants) {
  const opponentVariantImages = getVariantCardImages(opponentCardVariants ?? null);

  return `
    <section class="stack-sm" data-online-opponent-variant-tracker="true">
      <h3 class="section-title">Opponent Card Style</h3>
      <div class="online-waiting-preview-grid">
        ${ELEMENT_ORDER.map((element) => `
          <article class="online-waiting-preview-card" aria-label="Opponent ${formatElement(element)} variant">
            <img
              class="online-waiting-preview-art"
              src="${getCardImage(element, opponentVariantImages)}"
              alt="Opponent ${escapeHtml(formatElement(element))} card style"
            />
            <p class="online-waiting-preview-label">${escapeHtml(formatElement(element))}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSharedBattleResultPanel(battleResultView) {
  const placeholder = Boolean(battleResultView?.tone === "placeholder");
  return `
    <article
      class="panel online-shared-battle-result-panel online-shared-battle-result-panel-${escapeHtml(battleResultView?.tone ?? "neutral")}"
      data-online-shared-battle-result="true"
    >
      <div class="online-shared-battle-result-meta">
        <p class="online-shared-battle-result-kicker">Battle Result</p>
        <h3 class="online-shared-battle-result-headline">${escapeHtml(battleResultView?.headline ?? "Round ready")}</h3>
        ${
          placeholder
            ? ""
            : `<p class="online-shared-battle-result-line"><strong>Why:</strong> ${escapeHtml(battleResultView?.why ?? "")}</p>`
        }
        ${
          placeholder
            ? ""
            : `<p class="online-shared-battle-result-line"><strong>Changed:</strong> ${escapeHtml(battleResultView?.changed ?? "")}</p>`
        }
      </div>
    </article>
  `;
}

function formatPublicRoomAge(createdAt, now = Date.now()) {
  const createdAtMs = Date.parse(createdAt ?? "");
  if (!Number.isFinite(createdAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - createdAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

function renderPublicRoomBrowser(context = {}) {
  const rooms = Array.isArray(context.onlinePublicRooms) ? context.onlinePublicRooms : [];
  const status = String(context.onlinePublicRoomsStatus ?? "idle").trim().toLowerCase();
  const error = String(context.onlinePublicRoomsError ?? "").trim();
  const isLoading = status === "loading";

  let bodyMarkup = `<p class="online-public-room-empty">Browse waiting public rooms when you want a faster join path without sharing a code first.</p>`;

  if (isLoading) {
    bodyMarkup = `<p class="online-public-room-empty">Refreshing public rooms...</p>`;
  } else if (status === "error" && error) {
    bodyMarkup = `<p class="online-player-message"><strong>Notice:</strong> ${escapeHtml(error)}</p>`;
  } else if (status === "ready" && rooms.length === 0) {
    bodyMarkup = `<p class="online-public-room-empty">No public rooms available.</p>`;
  } else if (rooms.length > 0) {
    bodyMarkup = `
      <div class="online-public-room-list">
        ${rooms
          .map((room) => {
            const roomCode = escapeHtml(String(room?.roomCode ?? "").trim().toUpperCase());
            const createdLabel = formatPublicRoomAge(room?.createdAt, context.now) ?? "Just now";
            return `
              <article class="online-public-room-card" data-public-room-card="${roomCode}">
                <div class="online-public-room-copy">
                  <h3 class="online-public-room-host">${escapeHtml(room?.hostUsername ?? "Waiting Host")}</h3>
                  <p class="online-public-room-meta"><strong>Room Code:</strong> ${roomCode}</p>
                  <p class="online-public-room-meta"><strong>Status:</strong> ${escapeHtml(room?.status ?? "waiting")}</p>
                  <p class="online-public-room-meta"><strong>Created:</strong> ${escapeHtml(createdLabel)}</p>
                </div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  data-online-public-room-join="${roomCode}"
                >
                  Join
                </button>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  return `
    <section class="panel online-public-room-browser stack-sm">
      <div class="online-public-room-header">
        <div>
          <h3 class="section-title">Browse Public Rooms</h3>
          <p class="online-public-room-subtitle">Public rooms are listed only while they are still waiting for an opponent.</p>
        </div>
        <button
          id="online-refresh-public-rooms-btn"
          type="button"
          class="btn btn-secondary"
          ${isLoading ? "disabled" : ""}
        >
          ${isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      ${bodyMarkup}
    </section>
  `;
}

function renderOnlineLiveBoard(
  boardView,
  roomStateView,
  matchStatus,
  moveSyncLabel,
  roomLifecycle,
  onlineTurnTimer
) {
  const battleResultView = boardView.battleResultView ?? null;
  const localVariantRarities = getVariantRarityMap(boardView.localIdentity.variantSelection);
  const localCardBackRarity = getCardBackRarity(boardView.localIdentity.cardBackId);
  const remoteCardBackRarity = getCardBackRarity(boardView.remoteIdentity.cardBackId);

  return `
    <section class="grid game-grid online-play-live-grid">
      <article class="panel online-play-player-panel" style="background-image: url('${boardView.localIdentity.backgroundImage}')">
        <div class="online-play-player-panel-overlay">
          ${renderPlayerHeader(toPlayerDisplay(boardView.localIdentity), "Player", `(${boardView.localCount})`)}
          <div class="online-play-identity-strip">
            <img class="online-player-card-back-chip ${rarityClassName(localCardBackRarity)}" src="${boardView.localIdentity.cardBackImage}" alt="${escapeHtml(boardView.localIdentity.username)} card back" />
          </div>
          <div class="hand-zone hand-zone-player">
            <div class="hand-summary-grid" id="online-move-actions">
              ${renderElementHandSummary(boardView.localHand, "online", {
                selectable: boardView.selectable,
                selectableClass: "online-move-btn",
                variantMap: boardView.localVariantMap,
                rarityMap: localVariantRarities,
                buttonAttributes: ({ element }) => `data-move="${element}"`,
                isDisabled: ({ isAvailable }) => !(boardView.selectable && isAvailable && !boardView.ownSubmitted)
              })}
            </div>
            <p class="keyboard-hint">1 Fire · 2 Earth · 3 Wind · 4 Water</p>
          </div>
          ${renderSharedBattleResultPanel(battleResultView)}
        </div>
      </article>

      <article class="panel online-play-player-panel" style="background-image: url('${boardView.remoteIdentity.backgroundImage}')">
        <div class="online-play-player-panel-overlay">
          ${renderPlayerHeader(toPlayerDisplay(boardView.remoteIdentity), "Opponent", `(${boardView.remoteCount})`)}
          <div class="online-play-identity-strip">
            <img class="online-player-card-back-chip ${rarityClassName(remoteCardBackRarity)}" src="${boardView.remoteIdentity.cardBackImage}" alt="${escapeHtml(boardView.remoteIdentity.username)} card back" />
          </div>
          <div class="hand-zone hand-zone-opponent">
            <div class="hand-summary-grid hand-summary-grid-opponent" id="right-hand">
              ${renderHiddenHandSummary(boardView.remoteCount, boardView.remoteCardBack, remoteCardBackRarity)}
            </div>
          </div>
          ${renderOnlineOpponentVariantTracker(boardView.opponentCardVariants)}
        </div>
      </article>

      <article class="panel match-status-panel online-play-status-panel">
        <div class="status-meta">
          <div class="online-status-header-row">
            <div class="round-result-banner ${roomStateView.label === "Waiting for Opponent Move" ? "player-win is-active" : roomStateView.label === "Resolving Round" || roomStateView.label === "Resolving WAR" ? "war-triggered is-active" : "no-effect"}">
              <strong>${escapeHtml(roomStateView.label)}</strong>
            </div>
            <div
              class="${`online-turn-timer-shell ${onlineTurnTimer?.visible ? "" : "is-hidden"} ${onlineTurnTimer?.lowTime ? "is-low-time" : ""}`.trim()}"
              data-online-turn-timer-shell="true"
              aria-live="polite"
            >
              <span class="online-turn-timer-label" data-online-turn-timer-label="true">
                ${escapeHtml(onlineTurnTimer?.visible ? onlineTurnTimer.label : "")}
              </span>
            </div>
          </div>
          <p class="round-result-text">${escapeHtml(roomStateView.detail)}</p>
          ${matchStatus ? `<p class="round-status-line">Round ${escapeHtml(String(matchStatus.roundNumber))} | Host ${escapeHtml(String(matchStatus.hostScore))} - Guest ${escapeHtml(String(matchStatus.guestScore))}</p>` : ""}
          ${moveSyncLabel ? `<p class="round-status-line">Move Sync: ${escapeHtml(moveSyncLabel)}</p>` : ""}
          ${roomLifecycle?.primaryLabel ? `<p class="round-status-line">${escapeHtml(roomLifecycle.primaryLabel)}</p>` : ""}
        </div>
      </article>
    </section>
  `;
}

function renderWaitingBoardPreview(hostIdentity, roomCode, backgroundImage) {
  if (!hostIdentity) {
    return "";
  }

  const waitingOpponent = createWaitingOpponentIdentity(backgroundImage);

  return `
    <section class="grid game-grid online-play-live-grid">
      <article class="panel online-play-player-panel" data-online-player-card="host" style="background-image: url('${hostIdentity.backgroundImage}')">
        <div class="online-play-player-panel-overlay">
          ${renderPlayerHeader(toPlayerDisplay(hostIdentity), "Host", "")}
          <div class="online-play-identity-strip">
            <img class="online-player-card-back-chip" src="${hostIdentity.cardBackImage}" alt="${escapeHtml(hostIdentity.username)} card back" data-online-player-card-back="host-waiting" />
          </div>
          ${renderWaitingPreviewCards(hostIdentity, "host")}
        </div>
      </article>

      <article class="panel online-play-player-panel" data-online-player-card="guest" style="background-image: url('${waitingOpponent.backgroundImage}')">
        <div class="online-play-player-panel-overlay">
          ${renderPlayerHeader(toPlayerDisplay(waitingOpponent), "Guest", "")}
          ${renderWaitingOpponentPlaceholder()}
        </div>
      </article>

      <article class="panel match-status-panel online-play-status-panel">
        <div class="status-meta">
          <div class="round-result-banner no-effect is-active">
            <strong>Waiting for Opponent</strong>
          </div>
          <p class="round-result-text">Share room code ${escapeHtml(roomCode ?? "")} to start the online match.</p>
        </div>
      </article>
    </section>
  `;
}

function derivePlayersView(context) {
  const room = context.multiplayer?.room;
  if (!room) {
    return null;
  }

  return {
    host: room.hostResolvedIdentity ?? null,
    guest: room.guestResolvedIdentity ?? null
  };
}

function deriveRoomStateView(context) {
  const room = context.multiplayer?.room;
  const connectionStatus = context.multiplayer?.connectionStatus ?? "disconnected";
  const roleLabel = deriveRoleLabel(context);
  const moveSync = deriveMoveSyncView(context);
  const roomLifecycle = deriveRoomLifecycleView(context);
  const warStatus = deriveWarStatusView(context);
  const matchComplete = deriveMatchCompleteView(context);

  if (!room) {
    if (connectionStatus === "connecting") {
      return {
        label: "Connecting",
        detail: "Connecting to Online Play.",
        showReconnectCountdown: false
      };
    }

    if (connectionStatus === "connected") {
      return {
        label: "Ready",
        detail: "Create a room or join a room code.",
        showReconnectCountdown: false
      };
    }

    return {
      label: "Offline",
      detail: "Open Online Play to connect.",
      showReconnectCountdown: false
    };
  }

  if (matchComplete) {
    return {
      label: room.status === "closing" ? "Room Closing" : "Match Complete",
      detail:
        room.status === "closing"
          ? "Match settled. This room is closing."
          : "Match settled. Rewards and progression are available below.",
      showReconnectCountdown: false
    };
  }

  if (room.status === "waiting") {
    return {
      label: "Waiting for Opponent",
      detail: "Share the room code and wait for another player to join.",
      showReconnectCountdown: false
    };
  }

  if (room.status === "paused") {
    return {
      label: "Reconnect Paused",
      detail: "The match is paused while the disconnected player tries to return.",
      showReconnectCountdown: true
    };
  }

  if (room.status === "expired") {
    return {
      label: "No Contest",
      detail: "The reconnect window expired and the room can no longer resume.",
      showReconnectCountdown: false
    };
  }

  if (room.status === "closing") {
    return {
      label: "Room Closing",
      detail: "This room is closing and can no longer continue play.",
      showReconnectCountdown: false
    };
  }

  if (room.status !== "full") {
    return {
      label: "Room Active",
      detail: "Room state updated.",
      showReconnectCountdown: false
    };
  }

  if (room.disconnectState?.reason === "match_resumed" && Number(moveSync?.submittedCount ?? 0) === 0) {
    return {
      label: "Match Resumed",
      detail: "Reconnect succeeded. Play can continue normally.",
      showReconnectCountdown: false
    };
  }

  if (moveSync?.bothSubmitted) {
    return {
      label: warStatus ? "Resolving WAR" : "Resolving Round",
      detail: "Both players submitted. Waiting for the round result.",
      showReconnectCountdown: false
    };
  }

  if (warStatus) {
    return {
      label: moveSync?.ownSubmitted ? "WAR Active" : "WAR Active",
      detail: moveSync?.ownSubmitted
        ? "Your WAR move is locked in. Waiting for the opponent."
        : roleLabel
          ? "Choose your next WAR move."
          : "WAR is active.",
      showReconnectCountdown: false
    };
  }

  if (moveSync?.ownSubmitted) {
    return {
      label: "Waiting for Opponent Move",
      detail: "Your move is locked in. Waiting for the opponent.",
      showReconnectCountdown: false
    };
  }

  return {
    label: "Active Round",
    detail: "Choose your move for the current round.",
    showReconnectCountdown: false
  };
}

function deriveRoomLifecycleView(context) {
  const room = context.multiplayer?.room;
  const disconnectState = room?.disconnectState ?? null;
  const roomStatus = room?.status ?? null;
  if (!disconnectState?.active && disconnectState?.reason !== "match_resumed" && roomStatus !== "closing") {
    return null;
  }

  const reason = disconnectState?.reason ?? null;
  const disconnectedUsername = disconnectState?.disconnectedUsername ?? "Opponent";
  const expiresAt = disconnectState?.expiresAt ?? null;
  const currentTime = Number(context.now ?? Date.now());
  const secondsRemaining =
    expiresAt
      ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - currentTime) / 1000))
      : null;
  const primaryLabel =
    reason === "waiting_for_reconnect"
      ? `${disconnectedUsername} disconnected. Waiting to reconnect.`
      : reason === "disconnect_timeout_expired"
        ? "Reconnect timeout expired. Match ended with no contest."
        : reason === "post_match_disconnect"
          ? `${disconnectedUsername} disconnected after match completion.`
          : reason === "match_resumed"
            ? "Match resumed."
            : "Room closing.";

  return {
    primaryLabel,
    rematchUnavailable: roomStatus === "closing" || roomStatus === "expired" || reason === "waiting_for_reconnect",
    closingAt: room?.closingAt ?? null,
    secondsRemaining,
    formattedTimeRemaining:
      secondsRemaining === null
        ? null
        : `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`,
    waitingForReconnect: reason === "waiting_for_reconnect",
    expiredNoContest: reason === "disconnect_timeout_expired",
    resumed: reason === "match_resumed",
    roomCode: room?.roomCode ?? null,
    showRemainingPlayerCountdown:
      reason === "waiting_for_reconnect" &&
      String(context.username ?? "").trim() &&
      String(room?.disconnectState?.remainingUsername ?? "").trim() === String(context.username ?? "").trim()
  };
}

function deriveHandStatusView(context) {
  const room = context.multiplayer?.room;
  if (!room?.hostHand || !room?.guestHand) {
    return null;
  }

  const roleLabel = deriveRoleLabel(context);
  const ownHand = roleLabel === "Host" ? room.hostHand : roleLabel === "Guest" ? room.guestHand : null;

  return {
    hostHand: room.hostHand,
    guestHand: room.guestHand,
    ownHand
  };
}

function deriveMatchCompleteView(context) {
  const room = context.multiplayer?.room;
  const roleLabel = deriveSettledRoleLabel(context);
  if (!room?.matchComplete) {
    return null;
  }

  const perspectiveWinner =
    room.winner === "draw"
      ? "Draw"
      : room.winner === "host"
        ? roleLabel === "Host"
          ? "You Win"
          : "You Lose"
        : room.winner === "guest"
          ? roleLabel === "Guest"
            ? "You Win"
            : "You Lose"
          : "Match Complete";

  const ownReady =
    roleLabel === "Host"
      ? Boolean(room.rematch?.hostReady)
      : roleLabel === "Guest"
        ? Boolean(room.rematch?.guestReady)
        : false;

  return {
    winnerLabel: perspectiveWinner,
    winReason: room.winReason ?? null,
    hostReady: Boolean(room.rematch?.hostReady),
    guestReady: Boolean(room.rematch?.guestReady),
    ownReady,
    rewardDecision: room.rewardSettlement?.decision ?? null,
    roleLabel
  };
}

function deriveConnectionBannerView(context) {
  const room = context.multiplayer?.room ?? null;
  const connectionStatus = String(context.multiplayer?.connectionStatus ?? "disconnected").trim().toLowerCase();

  if (connectionStatus === "connecting") {
    return {
      tone: "connecting",
      label: "Connecting",
      detail: "Reaching the EleMintz online service now."
    };
  }

  if (connectionStatus !== "connected") {
    return {
      tone: "offline",
      label: "Offline",
      detail: "Not connected to EleMintz Online. Reconnect before creating or joining a room."
    };
  }

  if (room?.status === "paused") {
    return {
      tone: "warning",
      label: "Connected - Match Paused",
      detail: "The room is connected, but the match is paused while a player reconnects."
    };
  }

  if (room?.status === "full") {
    return {
      tone: "online",
      label: "Connected - Match Live",
      detail: "Online Play is connected and ready to resolve moves."
    };
  }

  if (room?.status === "waiting") {
    return {
      tone: "online",
      label: "Connected - Waiting Room",
      detail: "Your room is live. Share the code and wait for the opponent to join."
    };
  }

  return {
    tone: "online",
    label: "Connected",
    detail: "Connected to EleMintz Online. You can create a room or join an existing code."
  };
}

function getChallengeBucketSummary(bucket) {
  const challenges = Array.isArray(bucket?.challenges) ? bucket.challenges : [];
  const completed = challenges.filter((challenge) => challenge?.completed).length;
  return {
    completed,
    total: challenges.length,
    visibleChallenges: challenges.slice(0, 3)
  };
}

function renderChallengeBucket(title, bucket) {
  if (!bucket) {
    return "";
  }

  const summary = getChallengeBucketSummary(bucket);
  const resetMs = Number(bucket.msUntilReset ?? 0);
  const totalMinutes = Math.max(0, Math.floor(resetMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const visibleCompleted = summary.visibleChallenges.filter((challenge) => challenge?.completed).length;

  return `
    <section class="stack-sm">
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <p><strong>Completed:</strong> ${escapeHtml(String(summary.completed))}/${escapeHtml(String(summary.total))}</p>
      <p><strong>Visible Completed:</strong> ${escapeHtml(String(visibleCompleted))}</p>
      <p><strong>Resets In:</strong> ${escapeHtml(String(hours).padStart(2, "0"))}:${escapeHtml(String(minutes).padStart(2, "0"))}</p>
      ${
        summary.visibleChallenges.length > 0
          ? summary.visibleChallenges
              .map(
                (challenge) => `
                  <p>
                    <strong>${escapeHtml(challenge.name)}:</strong>
                    ${escapeHtml(String(challenge.progress ?? 0))}/${escapeHtml(String(challenge.goal ?? 0))}
                    ${challenge.completed ? "- Completed" : "- In Progress"}
                  </p>
                `
              )
              .join("")
          : "<p>No challenge data available.</p>"
      }
    </section>
  `;
}

function renderOnlineChallengeSummary(context) {
  const summary = context.onlineChallengeSummary;
  if (!summary?.daily && !summary?.weekly) {
    return "";
  }

  return `
    <section class="stack-sm">
      <h3 class="section-title">Challenges</h3>
      ${renderChallengeBucket("Daily Progress", summary.daily)}
      ${renderChallengeBucket("Weekly Progress", summary.weekly)}
    </section>
  `;
}

function formatRewardSummaryLine(rewards) {
  const tokens = Number(rewards?.tokens ?? 0);
  const xp = Number(rewards?.xp ?? 0);
  const basicChests = Number(rewards?.basicChests ?? 0);
  const parts = [];

  if (tokens > 0) {
    parts.push(`+${tokens} Tokens`);
  }

  if (xp > 0) {
    parts.push(`+${xp} XP`);
  }

  if (basicChests > 0) {
    parts.push(`+${basicChests} Basic Chest${basicChests === 1 ? "" : "s"}`);
  }

  return parts.join(", ");
}

function deriveAuthoritativeRewardLine(matchComplete) {
  const decision = matchComplete?.rewardDecision ?? null;
  const roleLabel = matchComplete?.roleLabel ?? null;
  const rewards =
    roleLabel === "Host"
      ? decision?.rewards?.host ?? null
      : roleLabel === "Guest"
        ? decision?.rewards?.guest ?? null
        : null;

  return formatRewardSummaryLine(rewards);
}

function formatBasicChestWaitingLine(profile) {
  const basicChests = Math.max(0, Number(profile?.chests?.basic ?? 0) || 0);
  return `${basicChests} Basic Chest${basicChests === 1 ? "" : "s"}`;
}

function formatOutcomeTypeLabel(outcomeType) {
  if (!outcomeType) {
    return "";
  }

  if (outcomeType === "no_effect") {
    return "NO EFFECT";
  }

  if (outcomeType === "war_resolved") {
    return "WAR RESOLVED";
  }

  return String(outcomeType).toUpperCase();
}

function deriveWarStatusView(context) {
  const room = context.multiplayer?.room;
  if (!room?.warActive) {
    return null;
  }

  const warRounds = Array.isArray(room.warRounds) ? room.warRounds.slice(-10) : [];

  return {
    warDepth: Number(room.warDepth ?? 0),
    warRounds: warRounds.map((entry) => ({
      round: Number(entry.round ?? 0),
      hostMove: formatMoveLabel(entry.hostMove),
      guestMove: formatMoveLabel(entry.guestMove),
      outcomeTypeLabel: formatOutcomeTypeLabel(entry.outcomeType)
    }))
  };
}

export const onlinePlayScreen = {
  render(context) {
    const multiplayer = context.multiplayer;
    const room = multiplayer?.room ?? null;
    const roleLabel = deriveRoleLabel(context);
    const moveSync = deriveMoveSyncView(context);
    const roundResult = deriveRoundResultView(context);
    const matchStatus = deriveMatchStatusView(context);
    const roomLifecycle = deriveRoomLifecycleView(context);
    const handStatus = deriveHandStatusView(context);
    const matchComplete = deriveMatchCompleteView(context);
    const warStatus = deriveWarStatusView(context);
    const playersView = derivePlayersView(context);
    const boardView = deriveOnlineBoardView(context);
    const roomStateView = deriveRoomStateView(context);
    const battleResultView = deriveSharedBattleResultView(context);
    const connectionBanner = deriveConnectionBannerView(context);
    const onlineTurnTimer = context.onlineTurnTimer ?? { visible: false, label: "", lowTime: false };
    const selectedVisibility =
      String(context.onlineCreateRoomVisibility ?? "").trim().toLowerCase() === "public"
        ? "public"
        : "private";
    const joinCode = escapeHtml(context.joinCode ?? "");
    const isBusy = multiplayer?.connectionStatus === "connecting";
    const errorMessage = String(context.formattedErrorMessage ?? "").trim()
      ? escapeHtml(context.formattedErrorMessage)
      : "";
    const publicRoomBrowserStatus = String(context.onlinePublicRoomsStatus ?? "idle").trim().toLowerCase();
    const showGeneralPreRoomNotice = errorMessage && publicRoomBrowserStatus === "idle";
    const roomCode = escapeHtml(room?.roomCode ?? "");
    const safeConnectionStatus = escapeHtml(multiplayer?.connectionStatus ?? "disconnected");
    const safeRoleLabel = roleLabel ? escapeHtml(roleLabel) : "";
    const localWaitingHostIdentity = room?.status === "waiting" ? playersView?.host ?? null : null;
    const activeBoardVisible = Boolean(boardView && !matchComplete);
    const waitingPreviewVisible = Boolean(localWaitingHostIdentity && !matchComplete);
    const moveSyncLabel = moveSync
      ? moveSync.bothSubmitted
        ? "Both players submitted."
        : `${moveSync.submittedCount}/2 submitted.`
      : "";

    if (roundResult) {
      console.info("[OnlinePlay][Renderer] rendering round result block", roundResult);
    }

      return `
        <section class="screen screen-online-play">
          <div class="screen-topbar">
            <h2 class="view-title">Online Play</h2>
            <button id="online-play-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          ${
            room?.status === "full" && !matchComplete
          ? renderMatchTauntHud({
              idPrefix: "online",
              panelOpen: Boolean(context.taunts?.panelOpen),
              messages: context.taunts?.messages ?? [],
              presetLines: context.taunts?.presetLines ?? [],
              cooldownRemainingMs: context.taunts?.cooldownRemainingMs ?? 0,
              canSend: context.taunts?.canSend ?? true
            })
              : ""
          }
          <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage}')">
              <div class="panel themed-screen-panel stack-sm">
              <section class="online-connection-banner online-connection-banner-${escapeHtml(connectionBanner.tone)}" aria-live="polite">
                <strong class="online-connection-banner-label">${escapeHtml(connectionBanner.label)}</strong>
                <span class="online-connection-banner-detail">${escapeHtml(connectionBanner.detail)}</span>
              </section>
              ${
                room
                ? `
                  <section class="stack-sm">
                    <p><strong>Room Code:</strong> ${roomCode}</p>
                    <p><strong>Match State:</strong> ${escapeHtml(roomStateView.label)}</p>
                    ${safeRoleLabel ? `<p><strong>Role:</strong> ${safeRoleLabel}</p>` : ""}
                    ${moveSyncLabel && activeBoardVisible ? `<p><strong>Sync:</strong> ${escapeHtml(moveSyncLabel)}</p>` : ""}
                    ${
                      roomLifecycle
                        ? `
                          <p><strong>Reconnect:</strong> ${escapeHtml(roomLifecycle.primaryLabel)}</p>
                          ${roomStateView.showReconnectCountdown && roomLifecycle.secondsRemaining !== null ? `<p><strong>Room Expires In:</strong> ${escapeHtml(String(roomLifecycle.formattedTimeRemaining ?? "00:00"))}</p>` : ""}
                          ${roomLifecycle.rematchUnavailable ? `<p><strong>Rematch:</strong> Unavailable</p>` : ""}
                        `
                        : ""
                    }
                  </section>
                `
                : `
                  <p><strong>Connection:</strong> ${safeConnectionStatus}</p>
                  <p><strong>Match State:</strong> ${escapeHtml(roomStateView.label)}</p>
                  <p>${escapeHtml(multiplayer?.statusMessage ?? "Offline. Open Online Play to connect.")}</p>
                  <div class="stack-sm">
                    <section class="online-room-visibility-panel stack-sm">
                      <div class="online-room-visibility-header">
                        <h3 class="section-title">Create Room</h3>
                        <p class="online-room-visibility-copy">Choose whether this room stays code-only or appears in the public room browser.</p>
                      </div>
                      <div class="online-room-visibility-toggle" role="group" aria-label="Room visibility">
                        <button
                          id="online-room-visibility-private-btn"
                          type="button"
                          class="btn btn-secondary ${selectedVisibility === "private" ? "is-selected" : ""}"
                          data-online-room-visibility="private"
                          aria-pressed="${selectedVisibility === "private" ? "true" : "false"}"
                          ${isBusy ? "disabled" : ""}
                        >
                          Private / code only
                        </button>
                        <button
                          id="online-room-visibility-public-btn"
                          type="button"
                          class="btn btn-secondary ${selectedVisibility === "public" ? "is-selected" : ""}"
                          data-online-room-visibility="public"
                          aria-pressed="${selectedVisibility === "public" ? "true" : "false"}"
                          ${isBusy ? "disabled" : ""}
                        >
                          Public / listed
                        </button>
                      </div>
                      <button id="online-create-room-btn" class="btn" ${isBusy ? "disabled" : ""}>Create Room</button>
                    </section>
                    <form id="online-join-room-form" class="stack-sm">
                      <label for="online-room-code-input">Join Room Code</label>
                      <input
                        id="online-room-code-input"
                        name="roomCode"
                        type="text"
                        maxlength="6"
                        value="${joinCode}"
                        placeholder="ABC123"
                      />
                      <button id="online-join-room-btn" type="submit" class="btn" ${isBusy ? "disabled" : ""}>Join Room</button>
                    </form>
                    ${renderPublicRoomBrowser(context)}
                  </div>
                `
            }
            ${showGeneralPreRoomNotice ? `<p class="online-player-message"><strong>Notice:</strong> ${errorMessage}</p>` : ""}
            ${
              waitingPreviewVisible
                ? renderWaitingBoardPreview(localWaitingHostIdentity, roomCode, context.backgroundImage)
                : ""
            }
            ${
              activeBoardVisible
                ? renderOnlineLiveBoard(
                    {
                      ...boardView,
                      battleResultView
                    },
                    roomStateView,
                    matchStatus,
                    moveSyncLabel,
                    roomLifecycle,
                    onlineTurnTimer
                  )
                : ""
            }
            ${battleResultView && !activeBoardVisible && room?.status === "full" && !matchComplete ? renderSharedBattleResultPanel(battleResultView) : ""}
            ${
              matchComplete
                ? `
                  <section class="panel stack-sm">
                    <h3 class="section-title">Match Complete</h3>
                    <p><strong>Winner:</strong> ${escapeHtml(matchComplete.winnerLabel)}</p>
                    ${matchComplete.winReason ? `<p><strong>Why:</strong> ${escapeHtml(String(matchComplete.winReason).replaceAll("_", " "))}</p>` : ""}
                    <p><strong>Host Ready:</strong> ${matchComplete.hostReady ? "Yes" : "No"}</p>
                    <p><strong>Guest Ready:</strong> ${matchComplete.guestReady ? "Yes" : "No"}</p>
                    ${
                      matchComplete.rewardDecision
                        ? `
                          <section class="stack-sm">
                            <h3 class="section-title">Rewards Granted</h3>
                            <p><strong>You Gained:</strong> ${escapeHtml(
                              deriveAuthoritativeRewardLine(matchComplete)
                            )}</p>
                            <p><strong>Basic Chests Waiting:</strong> ${escapeHtml(formatBasicChestWaitingLine(context.profile))}</p>
                          </section>
                        `
                        : ""
                    }
                    ${renderOnlineChallengeSummary(context)}
                    ${roomLifecycle?.rematchUnavailable ? "<p><strong>Rematch Unavailable</strong></p>" : ""}
                    <button id="online-ready-rematch-btn" class="btn" ${(matchComplete.ownReady || roomLifecycle?.rematchUnavailable) ? "disabled" : ""}>Ready for Rematch</button>
                  </section>
                `
                : ""
            }
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    detachOnlineKeyboardHandler?.();
    detachOnlineKeyboardHandler = null;

    bindCosmeticHoverPreview({
      root: (typeof document.querySelector === "function" ? document.querySelector(".screen-online-play") : null) ?? document,
      documentRef: document
    });

    document.getElementById("online-create-room-btn")?.addEventListener("click", context.actions.createRoom);
    document.getElementById("online-play-back-btn")?.addEventListener("click", context.actions.back);
    document.getElementById("online-ready-rematch-btn")?.addEventListener("click", context.actions.readyRematch);
    document.getElementById("online-refresh-public-rooms-btn")?.addEventListener("click", context.actions.browsePublicRooms);
    document.getElementById("online-room-visibility-private-btn")?.addEventListener("click", () =>
      context.actions.setCreateRoomVisibility?.("private")
    );
    document.getElementById("online-room-visibility-public-btn")?.addEventListener("click", () =>
      context.actions.setCreateRoomVisibility?.("public")
    );
    document.getElementById("online-taunts-toggle-btn")?.addEventListener("click", context.actions.toggleTauntsPanel);
    document.querySelectorAll("[data-taunt-line]").forEach((button) => {
      button.addEventListener("click", async () => {
        const line = button.getAttribute("data-taunt-line") ?? "";
        await context.actions.sendTaunt(line);
      });
    });

    const moveActions = document.getElementById("online-move-actions");
    const resolveOnlineMoveButton = (element) => {
      if (!element) {
        return null;
      }

      const moveButtons = Array.from(document.querySelectorAll?.(".online-move-btn") ?? []);
      return moveButtons.find((button) => {
        if (button?.hasAttribute?.("disabled")) {
          return false;
        }

        return String(button?.getAttribute?.("data-move") ?? "").trim().toLowerCase() === element;
      }) ?? null;
    };

    const submitOnlineMoveButton = async (button) => {
      if (!button || button.hasAttribute("disabled")) {
        return;
      }

      const move = button.getAttribute("data-move") ?? "";
      console.info("[OnlinePlay][Renderer] move extracted from button", {
        move
      });
      await context.actions.submitMove(move);
    };

    if (moveActions) {
      moveActions.addEventListener("click", async (event) => {
        console.info("[OnlinePlay][Renderer] move button click received", {
          targetType: event?.target?.nodeName ?? typeof event?.target
        });

        const button = findMoveButtonFromEvent(event);
        await submitOnlineMoveButton(button);
      });
    }

    const keyToElement = {
      "1": "fire",
      "2": "earth",
      "3": "wind",
      "4": "water"
    };

    const isEditableTarget = (target) => {
      const tagName = String(target?.tagName ?? target?.nodeName ?? "").trim().toUpperCase();
      if (target?.isContentEditable) {
        return true;
      }

      if (tagName === "TEXTAREA") {
        return true;
      }

      if (tagName === "INPUT") {
        return true;
      }

      return false;
    };

    const hasOpenModal = () => Boolean(document.querySelector?.(".modal-overlay"));

    const keydownHandler = async (event) => {
      const element = keyToElement[event?.key];
      if (!element || hasOpenModal()) {
        return;
      }

      if (isEditableTarget(event?.target) || isEditableTarget(document.activeElement)) {
        return;
      }

      const button = resolveOnlineMoveButton(element);
      if (!button) {
        return;
      }

      event.preventDefault?.();
      await submitOnlineMoveButton(button);
    };

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", keydownHandler);
      detachOnlineKeyboardHandler = () => {
        document.removeEventListener?.("keydown", keydownHandler);
      };
    }

    const joinForm = document.getElementById("online-join-room-form");
    joinForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const roomCode = String(formData.get("roomCode") ?? "").trim();
      await context.actions.joinRoom(roomCode);
    });

    document.querySelectorAll("[data-online-public-room-join]").forEach((button) => {
      button.addEventListener("click", async () => {
        const roomCode = String(button.getAttribute("data-online-public-room-join") ?? "").trim();
        await context.actions.joinRoom(roomCode);
      });
    });
  }
};
