import { ASSET_CATALOG, escapeHtml, getCardImage, formatElement } from "../../utils/index.js";
import { getCosmeticDefinition } from "../../../state/cosmeticSystem.js";
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
let lastFlashedWarSignature = null;
let pendingHotseatVisibleWarSignature = null;
let detachGameKeyboardHandler = null;

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

function renderWarPileSummary(pileCards, cardImages, emphasize) {
  const normalizedCards = Array.isArray(pileCards) ? pileCards.map((card) => getCardElement(card)) : [];

  return `
    <div class="war-summary-grid ${emphasize ? "is-emphasized" : ""}">
      ${ELEMENT_ORDER.map((element) => {
        const count = normalizedCards.reduce((sum, card) => sum + (card === element ? 1 : 0), 0);
        const variantMap = cardImages?.p1 ?? null;
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

function roundOutcomeLabel(vm, names) {
  if (vm.mode !== "local_pvp") {
    if (vm.warActive) {
      return "WAR triggered";
    }

    return vm.roundOutcome?.label ?? "No effect";
  }

  if (!vm.lastRound) {
    if (vm.warActive) {
      return "WAR triggered";
    }

    return "No effect";
  }

  if (vm.roundOutcome?.key === "war_triggered" || vm.warActive) {
    return "WAR triggered";
  }

  if (vm.lastRound.result === "p1") {
    return `${escapeHtml(names.p1)} wins`;
  }

  if (vm.lastRound.result === "p2") {
    return `${escapeHtml(names.p2)} wins`;
  }

  return "No effect";
}

function renderHands(vm, context, phase, names) {
  const hotseat = context.hotseat;
  const selectedCardIndex = context.presentation?.selectedCardIndex ?? null;
  const transitionLocked = Boolean(context.presentation?.busy ?? false);
  const canSelect = vm.canSelectCard && !transitionLocked;
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
          selectable: canSelect,
          selectedCardIndex,
          phase,
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
        selectable: canSelect,
          selectedCardIndex,
          phase,
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
      selectable: canSelect,
        selectedCardIndex,
        phase,
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
    const playedVariantRarities = {
      p1: getVariantRarityMap(context.cosmeticIds?.variants?.p1),
      p2: getVariantRarityMap(context.cosmeticIds?.variants?.p2)
    };
    const hotseatBusyReveal = vm.mode === "local_pvp" && phase === "reveal" && (context.presentation?.busy ?? false);
    const resultBannerActive = phase === "result" || phase === "reveal";
    const clashWinnerClass =
      vm.mode === "pve" && (phase === "reveal" || phase === "result")
        ? vm.lastRound?.result === "p1"
          ? `clash-winner-${getCardElement(vm.lastRound?.p1Card) ?? "neutral"}`
          : vm.lastRound?.result === "p2"
            ? `clash-winner-${getCardElement(vm.lastRound?.p2Card) ?? "neutral"}`
            : "clash-winner-neutral"
        : "";

    let roundMessage = vm.roundResult;
    if (!context.reducedMotion && phase === "reveal") {
      roundMessage = "Resolving clash...";
    }

    const compactTurnLabel = escapeHtml(context.hotseat?.turnLabel ?? "Player Turn");
    const capturedLeftName = escapeHtml(context.playerDisplay?.name ?? names.p1);
    const capturedRightName = escapeHtml(context.opponentDisplay?.name ?? names.p2);
    const warStatus = vm.pileCount > 0 || vm.totalWarClashes > 0
      ? `WAR Pile: ${vm.pileCount} | Clashes: ${vm.totalWarClashes}`
      : "WAR Pile: 0 | Clashes: 0";
    const capturedStatus = `Captured: ${capturedLeftName} • ${vm.captured.p1} | ${capturedRightName} • ${vm.captured.p2}`;

    return `
      <section class="screen screen-game phase-${phase}">
        <header class="hud panel">
          <div class="hud-summary">
            <h2 class="view-title">Game Screen</h2>
            <p class="hud-line">Round ${vm.round} | Turn: ${vm.timerSeconds}s | Match: ${formatClock(vm.totalMatchSeconds)} | ${compactTurnLabel}</p>
          </div>
          <div class="stack-sm inline-actions">
            <button id="back-menu-btn" class="btn">Back to Menu</button>
          </div>
        </header>

        <section class="arena-board" style="background-image: url('${context.arenaBackground}')">
          <section class="grid game-grid">
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

            <article class="panel match-status-panel ${outcomeClass(vm)} ${clashWinnerClass} ${warTriggered ? "war-impact" : ""}">
              ${warTriggered ? `<span id="war-impact-ring" class="war-impact-ring" aria-hidden="true"></span>` : ""}
              <div class="played-row compact-played-row ${hotseatBusyReveal ? "played-row-hotseat-hidden" : ""}">
                ${renderPlayedCard(vm.mode === "local_pvp" ? names.p1 : "Player", vm.lastRound?.p1Card, {
                  faceDown: hotseatBusyReveal,
                  emphasize: emphasizePlayed,
                  variantMap: context.cardImages?.p1,
                  backImage: context.cardBacks?.p1,
                  rarity: playedVariantRarities.p1[getCardElement(vm.lastRound?.p1Card) ?? "fire"]
                })}
                ${renderPlayedCard(vm.mode === "local_pvp" ? names.p2 : "Opponent", vm.lastRound?.p2Card, {
                  faceDown: hotseatBusyReveal,
                  emphasize: emphasizePlayed,
                  variantMap: context.cardImages?.p2,
                  backImage: context.cardBacks?.p2,
                  rarity: playedVariantRarities.p2[getCardElement(vm.lastRound?.p2Card) ?? "fire"]
                })}
              </div>
              <div class="status-meta">
                <div class="round-result-banner ${outcomeClass(vm)} ${resultBannerActive ? "is-active is-emphasized" : ""}">
                  <strong>${roundOutcomeLabel(vm, names)}</strong>
                </div>
                <p class="round-result-text">Result: ${roundMessage}</p>
                <p class="round-status-line">${warStatus}</p>
                <p class="round-status-line">${capturedStatus}</p>
                ${vm.warPileSizes?.length ? `<p class="round-status-line">WAR Progression: ${vm.warPileSizes.join(" -> ")}</p>` : ""}
              </div>
              <div class="war-pile-inline ${warTriggered ? "war-highlight" : ""}">
                ${renderWarPileSummary(vm.warPileCards, context.cardImages, warTriggered)}
              </div>
            </article>
          </section>
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
