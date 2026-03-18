import { ASSET_CATALOG, getCardImage, formatElement } from "../../utils/index.js";

const ELEMENT_ORDER = ["fire", "earth", "wind", "water"];
let lastFlashedWarSignature = null;
let pendingHotseatVisibleWarSignature = null;
let detachGameKeyboardHandler = null;

function getCardElement(card) {
  if (typeof card === "string") {
    return card.toLowerCase();
  }

  if (card && typeof card === "object") {
    const raw = card.element ?? card.type ?? card.name ?? null;
    return typeof raw === "string" ? raw.toLowerCase() : null;
  }

  return null;
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

function renderPlayerHandSummary(cards, owner, options) {
  const selectable = options.selectable;
  const variantMap = options.variantMap ?? null;
  const normalizedCards = Array.isArray(cards) ? cards.map((card) => getCardElement(card)) : [];

  return ELEMENT_ORDER.map((element) => {
    const firstIndex = normalizedCards.findIndex((card) => card === element);
    const count = normalizedCards.reduce((sum, card) => sum + (card === element ? 1 : 0), 0);
    const isAvailable = count > 0;
    const isSelected = isAvailable && options.selectedCardIndex === firstIndex;
    const classes = ["hand-slot", `hand-slot-${element}`];

    if (selectable && isAvailable) {
      classes.push("is-selectable");
    }

    if (!isAvailable) {
      classes.push("is-empty");
    }

    if (isSelected && options.phase === "play") {
      classes.push("is-playing");
    }

    return `
      <button
        class="${classes.join(" ")}"
        data-card-index="${isAvailable ? firstIndex : -1}"
        data-card-owner="${owner}"
        data-element="${element}"
        ${selectable && isAvailable ? "" : "disabled"}
      >
        <span class="card-art hand-slot-art" style="background-image: url('${getCardImage(element, variantMap)}')"></span>
        <span class="hand-slot-count-badge" aria-label="${formatElement(element)} count x${count}">x${count}</span>
      </button>
    `;
  }).join("");
}

function renderHiddenHandSummary(count, backImage = ASSET_CATALOG.cards.back) {
  const safeCount = Math.max(0, Number(count) || 0);
  const previewCount = Math.min(3, Math.max(1, safeCount));
  const stack = Array.from({ length: previewCount }, (_, index) => `
    <span
      class="hidden-hand-card hidden-hand-card-${index}"
      style="background-image: url('${backImage}')"
      aria-hidden="true"
    ></span>
  `).join("");

  return `
    <div class="hidden-hand-summary" aria-label="Hidden opponent hand: ${safeCount} cards">
      <div class="hidden-hand-stack">
        ${stack}
      </div>
      <div class="hidden-hand-count">x${safeCount}</div>
    </div>
  `;
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
  if (options.faceDown) {
    return `
      <div class="played-slot is-facedown">
        <p class="played-slot-label">${label}</p>
        <span class="card-art played-art card-art-facedown" style="background-image: url('${options.backImage ?? ASSET_CATALOG.cards.back}')"></span>
      </div>
    `;
  }

  if (!card) {
    return `<div class="played-slot"><p class="played-slot-label">${label}: -</p></div>`;
  }

  const classes = ["played-slot"];
  if (options.emphasize) {
    classes.push("is-emphasized");
  }

  return `
    <div class="${classes.join(" ")}">
      <p class="played-slot-label">${label}: ${formatElement(card)}</p>
      <span class="card-art played-art" style="background-image: url('${getCardImage(card, options.variantMap)}')"></span>
    </div>
  `;
}

function renderPlayerHeader(playerDisplay, fallbackName, countLabel) {
  const name = playerDisplay?.name ?? fallbackName;
  const title = playerDisplay?.title ?? "Initiate";
  const avatar = playerDisplay?.avatar ?? ASSET_CATALOG.avatars.default_avatar;
  const titleIcon = playerDisplay?.titleIcon ?? null;
  const featuredBadge = playerDisplay?.featuredBadge ?? null;

  return `
    <div class="player-header">
      <img class="player-avatar" src="${avatar}" alt="${name}" />
      <div>
        <h3>${name} ${countLabel}</h3>
        <p class="player-title">${titleIcon ? `<img class="title-icon" src="${titleIcon}" alt="${title}" />` : ""}<span>${title}</span>${featuredBadge ? `<img class="featured-badge" src="${featuredBadge}" alt="Featured Badge" />` : ""}</p>
      </div>
    </div>
  `;
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
    return `${names.p1} wins`;
  }

  if (vm.lastRound.result === "p2") {
    return `${names.p2} wins`;
  }

  return "No effect";
}

function renderHands(vm, context, phase, names) {
  const hotseat = context.hotseat;
  const selectedCardIndex = context.presentation?.selectedCardIndex ?? null;
  const transitionLocked = Boolean(context.presentation?.busy ?? false);
  const canSelect = vm.canSelectCard && !transitionLocked;

  if (!hotseat?.enabled) {
      return {
        leftTitle: renderPlayerHeader(context.playerDisplay, "Player", `(${vm.playerHand.length})`),
        leftCards: renderPlayerHandSummary(vm.playerHand, "active", {
          selectable: canSelect,
          selectedCardIndex,
          phase,
          variantMap: context.cardImages?.p1
        }),
        leftHint: true,
        rightTitle: renderPlayerHeader(context.opponentDisplay, "Opponent", `(${vm.opponentHand.length})`),
        rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2),
        rightHint: false
      };
  }

  if (transitionLocked) {
    return {
      leftTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
      leftCards: renderHiddenHandSummary(vm.playerHand.length, context.cardBacks?.p1),
      leftHint: false,
      rightTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
      rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2),
      rightHint: false
    };
  }

  const activePlayer = hotseat.activePlayer;
  if (activePlayer === "p2") {
    return {
      leftTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
      leftCards: renderPlayerHandSummary(vm.opponentHand, "active", {
        selectable: canSelect,
          selectedCardIndex,
          phase,
          variantMap: context.cardImages?.p2
        }),
      leftHint: true,
      rightTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
      rightCards: renderHiddenHandSummary(vm.playerHand.length, context.cardBacks?.p1),
      rightHint: false
    };
  }

  return {
    leftTitle: renderPlayerHeader(context.playerDisplay, names.p1, `(${vm.playerHand.length})`),
    leftCards: renderPlayerHandSummary(vm.playerHand, "active", {
      selectable: canSelect,
        selectedCardIndex,
        phase,
        variantMap: context.cardImages?.p1
      }),
    leftHint: true,
    rightTitle: renderPlayerHeader(context.opponentDisplay, names.p2, `(${vm.opponentHand.length})`),
    rightCards: renderHiddenHandSummary(vm.opponentHand.length, context.cardBacks?.p2),
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

    const compactTurnLabel = context.hotseat?.turnLabel ?? "Player Turn";
    const capturedLeftName = context.playerDisplay?.name ?? names.p1;
    const capturedRightName = context.opponentDisplay?.name ?? names.p2;
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
                  backImage: context.cardBacks?.p1
                })}
                ${renderPlayedCard(vm.mode === "local_pvp" ? names.p2 : "Opponent", vm.lastRound?.p2Card, {
                  faceDown: hotseatBusyReveal,
                  emphasize: emphasizePlayed,
                  variantMap: context.cardImages?.p2,
                  backImage: context.cardBacks?.p2
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
