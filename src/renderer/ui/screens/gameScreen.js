import { ASSET_CATALOG, escapeHtml, getCardImage, getVariantCardImages, formatElement } from "../../utils/index.js";
import { getCosmeticDefinition } from "../../../state/cosmeticSystem.js";
import { GAME_BATTLE_EXPRESSIONS_RAIL_OPTIONS, renderBattleExpressionsRail } from "../shared/battleExpressionsRail.js";
import {
  ELEMENT_ORDER,
  getCardElement,
  normalizeCosmeticRarity,
  rarityClassName,
  renderElementHandSummary,
  renderHiddenHandSummary,
  renderPlayerHeader
} from "../shared/playSurfaceShared.js";
import { bindCosmeticHoverPreview } from "../shared/cosmeticHoverPreview.js";
import {
  buildCenterRoundHeadline,
  renderCenterRoundPlaceholder,
  renderCenterRoundResult
} from "../shared/roundResultPresentation.js";
import { renderActiveMatchLayout } from "../shared/activeMatchLayout.js";
let lastFlashedWarSignature = null;
let pendingHotseatVisibleWarSignature = null;
let detachGameKeyboardHandler = null;

export function buildGameHudPrimaryLine({ game, hotseat }) {
  const vm = game ?? {};
  const compactTurnLabel = escapeHtml(hotseat?.turnLabel ?? "Player Turn");
  return `Round ${vm.round} | Turn: ${vm.timerSeconds}s | Match: ${formatClock(vm.totalMatchSeconds)} | ${compactTurnLabel}`;
}

export function buildGameLiveUpdateSignature(context) {
  const vm = context.game ?? {};
  return JSON.stringify({
    status: vm.status ?? null,
    winner: vm.winner ?? null,
    endReason: vm.endReason ?? null,
    round: vm.round ?? null,
    mode: vm.mode ?? null,
    hotseatTurn: vm.hotseatTurn ?? null,
    hotseatPending: Boolean(vm.hotseatPending),
    playerHand: Array.isArray(vm.playerHand) ? vm.playerHand : [],
    opponentHand: Array.isArray(vm.opponentHand) ? vm.opponentHand : [],
    warActive: Boolean(vm.warActive),
    pileCount: Number(vm.pileCount ?? 0),
    totalWarClashes: Number(vm.totalWarClashes ?? 0),
    warPileCards: Array.isArray(vm.warPileCards) ? vm.warPileCards : [],
    warPileSizes: Array.isArray(vm.warPileSizes) ? vm.warPileSizes : [],
    captured: {
      p1: Number(vm.captured?.p1 ?? 0),
      p2: Number(vm.captured?.p2 ?? 0)
    },
    lastRound: vm.lastRound
      ? {
          p1Card: vm.lastRound.p1Card ?? null,
          p2Card: vm.lastRound.p2Card ?? null,
          result: vm.lastRound.result ?? null,
          warClashes: Number(vm.lastRound.warClashes ?? 0),
          capturedCards: Number(vm.lastRound.capturedCards ?? 0),
          capturedOpponentCards: Number(vm.lastRound.capturedOpponentCards ?? 0)
        }
      : null,
    roundResult: vm.roundResult ?? "",
    roundOutcomeKey: vm.roundOutcome?.key ?? null,
    canSelectCard: Boolean(vm.canSelectCard),
    selectionFatigue: {
      blockedElement: vm.selectionFatigue?.blockedElement ?? null,
      label: vm.selectionFatigue?.label ?? null
    },
    presentation: {
      phase: context.presentation?.phase ?? "idle",
      busy: Boolean(context.presentation?.busy),
      selectedCardIndex: context.presentation?.selectedCardIndex ?? null
    },
    hotseat: {
      enabled: Boolean(context.hotseat?.enabled),
      activePlayer: context.hotseat?.activePlayer ?? null,
      p1Name: context.hotseat?.p1Name ?? null,
      p2Name: context.hotseat?.p2Name ?? null,
      turnLabel: context.hotseat?.turnLabel ?? null
    },
    gauntlet: context.gauntlet
      ? {
          active: Boolean(context.gauntlet.active),
          currentStreak: Number(context.gauntlet.currentStreak ?? 0),
          rivalName: context.gauntlet.rivalName ?? null,
          rivalTitle: context.gauntlet.rivalTitle ?? null,
          rivalHint: context.gauntlet.rivalHint ?? null
        }
      : null
  });
}

function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = String(Math.floor(safe / 60)).padStart(2, "0");
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function getWarPresentationSignature(context) {
  const vm = context.game ?? {};
  const lastRound = vm.lastRound ?? {};
  return [
    vm.mode ?? "unknown",
    vm.round ?? "0",
    vm.totalWarClashes ?? "0",
    vm.pileCount ?? "0",
    lastRound.result ?? "none",
    getCardElement(lastRound.p1Card) ?? "none",
    getCardElement(lastRound.p2Card) ?? "none"
  ].join("|");
}

function renderWarPileSummary(pileCards, opponentCardVariantImages, emphasize) {
  const normalizedCards = Array.isArray(pileCards) ? pileCards.map((card) => getCardElement(card)) : [];

  return `
    <div class="war-summary-shell">
      <p class="war-summary-label">Opponent Cards</p>
      <div class="war-summary-grid ${emphasize ? "is-emphasized" : ""}">
        ${ELEMENT_ORDER.map((element) => {
          const count = normalizedCards.reduce((sum, card) => sum + (card === element ? 1 : 0), 0);
          const variantMap = opponentCardVariantImages ?? null;
          const classes = ["war-slot", `war-slot-${element}`];

          if (count === 0) {
            classes.push("is-empty");
          }

          return `
            <div class="${classes.join(" ")}" aria-label="WAR ${formatElement(element)} x${count}">
              <span class="card-art war-slot-art" style="background-image: url('${getCardImage(element, variantMap)}')"></span>
              <span class="war-slot-count-badge">x${count}</span>
              <span class="war-slot-name">${formatElement(element)}</span>
            </div>
          `;
        }).join("")}
      </div>
      <p class="war-summary-helper">WAR pile tracks committed cards.</p>
    </div>
  `;
}

function renderPlayedCard(label, card, options) {
  const safeLabel = escapeHtml(label);

  if (options.faceDown) {
    return `
      <div class="played-slot is-facedown">
        <p class="played-slot-label">${safeLabel}</p>
        <span class="card-art played-art card-art-facedown" style="background-image: url('${options.backImage ?? ASSET_CATALOG.cards.back}')"></span>
      </div>
    `;
  }

  if (!card) {
    return `<div class="played-slot"><p class="played-slot-label">${safeLabel}: -</p></div>`;
  }

  const classes = ["played-slot", rarityClassName(options.rarity ?? "Common")];
  if (options.emphasize) {
    classes.push("is-emphasized");
  }

  return `
    <div class="${classes.join(" ")}">
      <p class="played-slot-label">${safeLabel}: ${formatElement(card)}</p>
      <span class="card-art played-art" style="background-image: url('${getCardImage(card, options.variantMap)}')"></span>
    </div>
  `;
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

function outcomeClass(vm) {
  const key = vm.roundOutcome?.key;

  if (vm.warActive) {
    return "war-triggered";
  }

  if (key === "player_win") {
    return "player-win";
  }

  if (key === "opponent_win") {
    return "opponent-win";
  }

  if (key === "war_triggered") {
    return "war-triggered";
  }

  return "no-effect";
}

function getPerspectiveNames(vm, context, names) {
  if (vm.mode === "local_pvp") {
    return {
      left: names.p1,
      right: names.p2
    };
  }

  return {
    left: context.playerDisplay?.name ?? "You",
    right: context.opponentDisplay?.name ?? "Opponent"
  };
}

function buildRoundReasonLine(vm) {
  const reason = String(vm.roundResult ?? "").trim();

  if (reason) {
    return reason;
  }

  if (vm.warActive || vm.roundOutcome?.key === "war_triggered") {
    return "The cards tied, so the WAR pile carries into the next clash.";
  }

  return "Cards were resolved and the match state has been updated.";
}

function buildRoundChangeLine(vm, labels) {
  const capturedCards = Math.max(0, Number(vm.lastRound?.capturedCards ?? 0) || 0);
  const warClashes = Math.max(0, Number(vm.lastRound?.warClashes ?? 0) || 0);
  const winner =
    vm.lastRound?.result === "p1"
      ? labels.left
      : vm.lastRound?.result === "p2"
        ? labels.right
        : "";

  if (vm.warActive || vm.roundOutcome?.key === "war_triggered") {
    const pileCount = Math.max(0, Number(vm.pileCount ?? 0) || 0);
    return `The WAR pile now holds ${pileCount} card${pileCount === 1 ? "" : "s"} for the next reveal.`;
  }

  if (winner && capturedCards > 0) {
    const clashSuffix =
      warClashes > 0
        ? ` after ${warClashes} WAR clash${warClashes === 1 ? "" : "es"}`
        : "";
    return `${winner} captured ${capturedCards} card${capturedCards === 1 ? "" : "s"}${clashSuffix}.`;
  }

  return `Captured totals are now ${labels.left} ${vm.captured.p1} and ${labels.right} ${vm.captured.p2}.`;
}

function renderGauntletStatus(context) {
  if (!context.gauntlet?.active) {
    return "";
  }

  const streak = Math.max(0, Number(context.gauntlet.currentStreak ?? 0));
  const rivalName = escapeHtml(context.gauntlet.rivalName ?? "Arena Rival");
  const rivalTitle = escapeHtml(context.gauntlet.rivalTitle ?? "Gauntlet Rival");
  const rivalHint = String(context.gauntlet.rivalHint ?? "").trim();

  return `
    <section class="panel gauntlet-status-panel">
      <div class="gauntlet-status-panel__header">
        <p class="gauntlet-status-panel__eyebrow">Gauntlet Mode</p>
        <p class="gauntlet-status-panel__streak">Current Streak: ${streak}</p>
      </div>
      <div class="gauntlet-status-panel__identity">
        <strong class="gauntlet-status-panel__name">${rivalName}</strong>
        <span class="gauntlet-status-panel__title">${rivalTitle}</span>
      </div>
      ${rivalHint ? `<p class="gauntlet-status-panel__hint">${escapeHtml(rivalHint)}</p>` : ""}
    </section>
  `;
}

function deriveCenterCardsFromWarPile(warPileCards = []) {
  const normalizedCards = Array.isArray(warPileCards)
    ? warPileCards.map((card) => getCardElement(card)).filter(Boolean)
    : [];

  if (normalizedCards.length < 2) {
    return {
      leftCard: null,
      rightCard: null
    };
  }

  return {
    leftCard: normalizedCards[normalizedCards.length - 2] ?? null,
    rightCard: normalizedCards[normalizedCards.length - 1] ?? null
  };
}

function buildLocalCenterResultView(vm, context, names, roundMessage, hotseatBusyReveal) {
  let leftCard = getCardElement(vm.lastRound?.p1Card) ?? null;
  let rightCard = getCardElement(vm.lastRound?.p2Card) ?? null;
  const war = Boolean(vm.warActive || vm.roundOutcome?.key === "war_triggered");
  const activeWarCards = war ? vm.activeWarClashCards ?? null : null;

  if (activeWarCards?.p1Card && activeWarCards?.p2Card) {
    leftCard = getCardElement(activeWarCards.p1Card) ?? leftCard;
    rightCard = getCardElement(activeWarCards.p2Card) ?? rightCard;
  }

  if (!leftCard || !rightCard) {
    const warPilePair = deriveCenterCardsFromWarPile(vm.warPileCards);
    leftCard = leftCard ?? warPilePair.leftCard;
    rightCard = rightCard ?? warPilePair.rightCard;
  }

  const hasCompletedRound = Boolean(leftCard && rightCard);

  if (!hasCompletedRound) {
    return null;
  }

  const noEffect =
    !war && (vm.roundOutcome?.key === "no_effect" || (vm.lastRound?.result !== "p1" && vm.lastRound?.result !== "p2"));
  const winnerSide =
    noEffect || war
      ? null
      : vm.lastRound?.result === "p1"
        ? "left"
        : vm.lastRound?.result === "p2"
          ? "right"
          : null;
  const loserSide = winnerSide === "left" ? "right" : winnerSide === "right" ? "left" : null;
  const warResolved = !war && !noEffect && Math.max(0, Number(vm.lastRound?.warClashes ?? 0) || 0) > 0;
  const motionState = war ? "war" : noEffect ? "no-effect" : warResolved ? "war-resolved" : "resolved";

  const opponentVariantImages = getVariantCardImages(context.opponentCardVariants ?? null);

  return {
    tone: outcomeClass(vm),
    motionState,
    leftLabel: vm.mode === "local_pvp" ? names.p1 : "Player",
    rightLabel: vm.mode === "local_pvp" ? names.p2 : "Opponent",
    leftCard,
    rightCard,
    leftCardState: winnerSide === "left" ? "winner" : loserSide === "left" ? "loser" : "neutral",
    rightCardState: winnerSide === "right" ? "winner" : loserSide === "right" ? "loser" : "neutral",
    stackSweepSide: warResolved ? winnerSide : null,
    leftVariantMap: context.cardImages?.p1,
    rightVariantMap: opponentVariantImages,
    leftBackImage: context.cardBacks?.p1,
    rightBackImage: context.cardBacks?.p2,
    cardsHidden: hotseatBusyReveal,
    headline: buildCenterRoundHeadline({
      leftCard,
      rightCard,
      winner: winnerSide,
      war,
      noEffect
    }),
    subtext: roundMessage
  };
}

function renderHands(vm, context, phase, names) {
  const hotseat = context.hotseat;
  const selectedCardIndex = context.presentation?.selectedCardIndex ?? null;
  const transitionLocked = Boolean(context.presentation?.busy ?? false);
  const canSelect = vm.canSelectCard && !transitionLocked;
  const blockedFatiguedElement = String(vm.selectionFatigue?.blockedElement ?? "").trim().toLowerCase() || null;
  const fatigueLabel = String(vm.selectionFatigue?.label ?? "").trim() || null;
  const fatigueMessage = String(vm.selectionFatigue?.message ?? "").trim() || null;
  const activeHandOptions = {
    selectable: canSelect,
    selectedCardIndex,
    phase,
    getBadgeText: ({ element }) => (blockedFatiguedElement === element ? fatigueLabel : null),
    getTitle: ({ element }) => (blockedFatiguedElement === element ? fatigueMessage : null),
    isDisabled: ({ element, isAvailable }) =>
      !(canSelect && isAvailable) || blockedFatiguedElement === element
  };
  const variantRarities = {
    p1: getVariantRarityMap(context.cosmeticIds?.variants?.p1),
    p2: getVariantRarityMap(context.cosmeticIds?.variants?.p2)
  };
  const cardBackRarities = {
    p1: getCardBackRarity(context.cosmeticIds?.cardBacks?.p1),
    p2: getCardBackRarity(context.cosmeticIds?.cardBacks?.p2)
  };

  if (!hotseat?.enabled) {
      return {
        leftTitle: renderPlayerHeader(context.playerDisplay, "Player", `(${vm.playerHand.length})`),
        leftCards: renderElementHandSummary(vm.playerHand, "active", {
          ...activeHandOptions,
          variantMap: context.cardImages?.p1,
          rarityMap: variantRarities.p1
        }),
        leftHint: true,
        rightTitle: renderPlayerHeader(context.opponentDisplay, "Opponent", `(${vm.opponentHand.length})`),
        rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2, cardBackRarities.p2),
        rightHint: false
      };
  }

  if (transitionLocked) {
    return {
      leftTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
      leftCards: renderHiddenHandSummary(vm.playerHand.length, context.cardBacks?.p1, cardBackRarities.p1),
      leftHint: false,
      rightTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
      rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2, cardBackRarities.p2),
      rightHint: false
    };
  }

  const activePlayer = hotseat.activePlayer;
  if (activePlayer === "p2") {
    return {
      leftTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
      leftCards: renderElementHandSummary(vm.opponentHand, "active", {
          ...activeHandOptions,
          variantMap: context.cardImages?.p2,
          rarityMap: variantRarities.p2
        }),
      leftHint: true,
      rightTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
      rightCards: renderHiddenHandSummary(vm.playerHand.length, context.cardBacks?.p1, cardBackRarities.p1),
      rightHint: false
    };
  }

  return {
    leftTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
    leftCards: renderElementHandSummary(vm.playerHand, "active", {
        ...activeHandOptions,
        variantMap: context.cardImages?.p1,
        rarityMap: variantRarities.p1
      }),
    leftHint: true,
    rightTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
    rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2, cardBackRarities.p2),
    rightHint: false
  };
}

export const gameScreen = {
  render(context) {
    const vm = context.game;
    const names = {
      p1: context.hotseat?.p1Name ?? "Player 1",
      p2: context.hotseat?.p2Name ?? "Player 2"
    };
      const phase = context.presentation?.phase ?? "idle";
      const warTriggered = vm.roundOutcome?.key === "war_triggered" || Boolean(vm.warActive);
      const emphasizePlayed = phase === "reveal" || phase === "result";
      const hands = renderHands(vm, context, phase, names);
      const opponentCardVariantImages = getVariantCardImages(context.opponentCardVariants ?? null);
    const playedVariantRarities = {
      p1: getVariantRarityMap(context.cosmeticIds?.variants?.p1),
      p2: getVariantRarityMap(context.cosmeticIds?.variants?.p2)
    };
    const labels = getPerspectiveNames(vm, context, names);
    const hotseatBusyReveal = vm.mode === "local_pvp" && phase === "reveal" && (context.presentation?.busy ?? false);
    const clashWinnerClass =
      vm.mode === "pve" && (phase === "reveal" || phase === "result")
        ? vm.lastRound?.result === "p1"
          ? `clash-winner-${getCardElement(vm.lastRound?.p1Card) ?? "neutral"}`
          : vm.lastRound?.result === "p2"
            ? `clash-winner-${getCardElement(vm.lastRound?.p2Card) ?? "neutral"}`
            : "clash-winner-neutral"
        : "";

    let roundMessage = buildRoundReasonLine(vm);
    if (!context.reducedMotion && phase === "reveal") {
      roundMessage = "Resolving clash...";
    }
    const roundChangeMessage = buildRoundChangeLine(vm, labels);
    const centerResultView = buildLocalCenterResultView(vm, context, names, roundMessage, hotseatBusyReveal);

    const compactTurnLabel = escapeHtml(context.hotseat?.turnLabel ?? "Player Turn");
    const capturedLeftName = escapeHtml(labels.left);
    const capturedRightName = escapeHtml(labels.right);
    const warStatus =
      vm.warActive || vm.pileCount > 0 || vm.totalWarClashes > 0
        ? `WAR status: ${vm.pileCount} card${vm.pileCount === 1 ? "" : "s"} in the pile across ${vm.totalWarClashes} clash${vm.totalWarClashes === 1 ? "" : "es"}.`
        : "WAR status: No active WAR pile.";
    const capturedStatus = `Captured totals: ${capturedLeftName} ${vm.captured.p1} | ${capturedRightName} ${vm.captured.p2}`;

    return `
      <section class="screen screen-game phase-${phase}" data-game-live-update-signature="${escapeHtml(buildGameLiveUpdateSignature(context))}">
        <header class="hud panel">
          <div class="hud-summary">
            <h2 class="view-title">Game Screen</h2>
            <p id="game-hud-primary-line" class="hud-line">${buildGameHudPrimaryLine(context)}</p>
          </div>
          <div class="stack-sm inline-actions">
            <button id="back-menu-btn" class="btn">Back to Menu</button>
          </div>
        </header>
        ${renderGauntletStatus(context)}

        <section class="arena-board" style="background-image: url('${context.arenaBackground}')">
          ${renderActiveMatchLayout({
            variant: "game",
            mainSlotHtml: `
              <section class="grid game-grid game-active-match-grid">
                <article class="panel">
                  ${hands.leftTitle}
                  <div class="hand-zone hand-zone-player">
                    <div class="hand-summary-grid" id="left-hand">${hands.leftCards}</div>
                    ${hands.leftHint ? '<p class="keyboard-hint">Keyboard: [1] Fire   [2] Earth   [3] Wind   [4] Water</p>' : ""}
                  </div>
                </article>

                <article class="panel">
                  ${hands.rightTitle}
                  <div class="hand-zone hand-zone-opponent">
                    <div class="hand-summary-grid hand-summary-grid-opponent" id="right-hand">${hands.rightCards}</div>
                    ${hands.rightHint ? '<p class="keyboard-hint">Keyboard: [1] Fire   [2] Earth   [3] Wind   [4] Water</p>' : ""}
                  </div>
                </article>
              </section>
            `,
            expressionsSlotHtml: renderBattleExpressionsRail({
                idPrefix: "game",
                panelOpen: Boolean(context.taunts?.panelOpen),
                messages: context.taunts?.messages ?? [],
                presetLines: context.taunts?.presetLines ?? [],
                cooldownRemainingMs: context.taunts?.cooldownRemainingMs ?? 0,
                canSend: context.taunts?.canSend ?? true
              }, GAME_BATTLE_EXPRESSIONS_RAIL_OPTIONS),
            statusSlotHtml: `
              <article class="panel match-status-panel ${outcomeClass(vm)} ${clashWinnerClass} ${warTriggered ? "war-impact" : ""}">
                ${warTriggered ? `<span id="war-impact-ring" class="war-impact-ring" aria-hidden="true"></span>` : ""}
                <div class="game-status-zone game-status-zone-left" data-game-status-zone="left">
                  <div class="war-pile-inline ${warTriggered ? "war-highlight" : ""}">
                    ${renderWarPileSummary(vm.warPileCards, opponentCardVariantImages, warTriggered)}
                  </div>
                </div>
                <div class="game-status-zone game-status-zone-center" data-game-status-zone="center">
                  ${centerResultView ? renderCenterRoundResult(centerResultView) : renderCenterRoundPlaceholder()}
                </div>
                <div class="game-status-zone game-status-zone-right" data-game-status-zone="right">
                  <div class="status-meta">
                    <p class="round-status-line">Round update: ${escapeHtml(roundChangeMessage)}</p>
                    <p class="round-status-line">${warStatus}</p>
                    <p class="round-status-line">${capturedStatus}</p>
                    ${vm.warPileSizes?.length ? `<p class="round-status-line">WAR progression: ${vm.warPileSizes.join(" -> ")}</p>` : ""}
                  </div>
                </div>
                </article>
            `
          })}
        </section>
        ${
          context.hotseat?.enabled
            ? `
              <div id="hotseat-privacy-overlay" class="hotseat-privacy-overlay" aria-hidden="true" hidden>
                <div class="hotseat-privacy-panel">
                  <h3 id="hotseat-privacy-title">Pass device</h3>
                  <p id="hotseat-privacy-body">Hands are hidden while the next hotseat step begins.</p>
                </div>
              </div>
            `
            : ""
        }
      </section>
    `;
  },
  bind(context) {
    bindCosmeticHoverPreview({
      root: (typeof document.querySelector === "function" ? document.querySelector(".screen-game") : null) ?? document,
      documentRef: document
    });

    detachGameKeyboardHandler?.();
    detachGameKeyboardHandler = null;

    document.getElementById("back-menu-btn").addEventListener("click", context.actions.backToMenu);
    let locked = false;

    const warImpactRing = document.getElementById("war-impact-ring");
    const localPvpWarHiddenTransition =
      context.hotseat?.enabled && Boolean(context.presentation?.busy ?? false);
    const warTriggered =
      context.game?.roundOutcome?.key === "war_triggered" || Boolean(context.game?.warActive);
    const warSignature = warTriggered ? getWarPresentationSignature(context) : null;

    if (context.hotseat?.enabled && localPvpWarHiddenTransition && warTriggered) {
      pendingHotseatVisibleWarSignature = warSignature;
    }

    if (context.hotseat?.enabled && !warTriggered && !localPvpWarHiddenTransition) {
      pendingHotseatVisibleWarSignature = null;
    }

    const shouldActivateWarImpact =
      warTriggered &&
      warImpactRing &&
      !localPvpWarHiddenTransition &&
      (
        pendingHotseatVisibleWarSignature === warSignature ||
        lastFlashedWarSignature !== warSignature
      );

    if (shouldActivateWarImpact) {
      pendingHotseatVisibleWarSignature = null;
      lastFlashedWarSignature = warSignature;
      warImpactRing.classList.remove("is-active");
      void warImpactRing.offsetWidth;

      const activateWarImpact = () => {
        warImpactRing.classList.add("is-active");
      };

      if (typeof globalThis.requestAnimationFrame === "function") {
        if (context.hotseat?.enabled) {
          globalThis.requestAnimationFrame(() => {
            globalThis.requestAnimationFrame(activateWarImpact);
          });
        } else {
          globalThis.requestAnimationFrame(activateWarImpact);
        }
      } else {
        activateWarImpact();
      }
    }

    const privacyOverlay = document.getElementById("hotseat-privacy-overlay");
    const privacyTitle = document.getElementById("hotseat-privacy-title");
    const privacyBody = document.getElementById("hotseat-privacy-body");
    const activateHotseatPrivacy = (stage) => {
      if (!privacyOverlay) {
        return;
      }

      if (stage === "handoff") {
        if (privacyTitle) {
          privacyTitle.textContent = "Player 2 Turn";
        }
        if (privacyBody) {
          privacyBody.textContent = "Pass device to the next player.";
        }
      } else {
        if (privacyTitle) {
          privacyTitle.textContent = "Resolving round...";
        }
        if (privacyBody) {
          privacyBody.textContent = "Hands are hidden while the round resolves.";
        }
      }

      privacyOverlay.hidden = false;
      privacyOverlay.setAttribute("aria-hidden", "false");
      privacyOverlay.classList.add("is-active");
    };

    const selectButton = async (button) => {
      if (!button || locked || button.hasAttribute("disabled")) {
        return;
      }

      locked = true;
      button.classList.remove("is-selection-confirmed");
      void button.offsetWidth;
      button.classList.add("is-selection-confirmed");
      button.classList.add("is-playing-click");
      document.querySelectorAll("[data-card-owner='active']").forEach((cardButton) => {
        cardButton.setAttribute("disabled", "disabled");
      });

      if (context.hotseat?.enabled) {
        activateHotseatPrivacy(context.hotseat.activePlayer === "p1" ? "handoff" : "resolve");
      }

      try {
        const index = Number(button.getAttribute("data-card-index"));
        await context.actions.playCard(index);
      } finally {
        if (button.isConnected === false) {
          return;
        }

        locked = false;
        document.querySelectorAll("[data-card-owner='active']").forEach((cardButton) => {
          if (cardButton.getAttribute("data-card-index") !== "-1") {
            cardButton.removeAttribute?.("disabled");
          }
        });

        if (privacyOverlay) {
          privacyOverlay.classList.remove("is-active");
          privacyOverlay.setAttribute("aria-hidden", "true");
          privacyOverlay.hidden = true;
        }
      }
    };

    document.querySelectorAll("[data-card-owner='active']").forEach((button) => {
      button.addEventListener("click", async () => {
        await selectButton(button);
      });
    });

    const keyToElement = {
      "1": "fire",
      "2": "earth",
      "3": "wind",
      "4": "water"
    };

    const hasOpenModal = () => Boolean(document.querySelector?.(".modal-overlay"));

    const keydownHandler = async (event) => {
      const element = keyToElement[event.key];
      if (!element || locked || hasOpenModal()) {
        return;
      }

      const activeButton = Array.from(document.querySelectorAll("[data-card-owner='active']")).find(
        (button) => button.getAttribute("data-element") === element && !button.hasAttribute("disabled")
      );

      if (!activeButton) {
        return;
      }

      event.preventDefault?.();
      await selectButton(activeButton);
    };

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", keydownHandler);
      detachGameKeyboardHandler = () => {
        document.removeEventListener?.("keydown", keydownHandler);
      };
    }
  }
};
