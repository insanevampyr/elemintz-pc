import { ASSET_CATALOG, escapeHtml, formatElement, getCardImage } from "../../utils/index.js";

function normalizeToneClass(tone) {
  const normalized = String(tone ?? "").trim().toLowerCase();

  if (normalized === "win" || normalized === "player-win") {
    return "player-win";
  }

  if (normalized === "loss" || normalized === "opponent-win") {
    return "opponent-win";
  }

  if (normalized === "war" || normalized === "war-triggered") {
    return "war-triggered";
  }

  return "no-effect";
}

function normalizeMotionState(motionState) {
  const normalized = String(motionState ?? "").trim().toLowerCase();

  if (normalized === "resolved") {
    return "resolved";
  }

  if (normalized === "war-resolved") {
    return "war-resolved";
  }

  if (normalized === "war") {
    return "war";
  }

  return "no-effect";
}

function normalizeCardState(cardState) {
  const normalized = String(cardState ?? "").trim().toLowerCase();

  if (normalized === "winner") {
    return "winner";
  }

  if (normalized === "loser") {
    return "loser";
  }

  return "neutral";
}

function getClashLabel(view = {}) {
  const motionState = normalizeMotionState(view.motionState);

  if (motionState === "war" || motionState === "war-resolved") {
    return "WAR";
  }

  if (motionState === "no-effect") {
    return "TIE";
  }

  return "VS";
}

function renderCenterResultCard(label, card, options = {}) {
  const safeLabel = escapeHtml(label ?? "");
  const side = escapeHtml(options.side ?? "card");
  const cardState = normalizeCardState(options.cardState);
  const slotClasses = [
    "played-slot",
    "round-center-result-slot",
    `round-center-result-slot-${String(options.side ?? "card").trim().toLowerCase() || "card"}`,
    `is-${cardState}`
  ];

  if (options.faceDown) {
    return `
      <div class="${slotClasses.join(" ")} is-facedown" data-round-center-card="${side}" data-round-center-card-state="${escapeHtml(cardState)}">
        <p class="played-slot-label">${safeLabel}</p>
        <span class="card-art played-art card-art-facedown" data-round-center-card-art="${side}" style="background-image: url('${options.backImage ?? ASSET_CATALOG.cards.back}')"></span>
      </div>
    `;
  }

  if (!card) {
    return `
      <div class="${slotClasses.join(" ")}" data-round-center-card="${side}" data-round-center-card-state="${escapeHtml(cardState)}">
        <p class="played-slot-label">${safeLabel}: -</p>
      </div>
    `;
  }

  return `
    <div class="${slotClasses.join(" ")}" data-round-center-card="${side}" data-round-center-card-state="${escapeHtml(cardState)}">
      <p class="played-slot-label">${safeLabel}: ${formatElement(card)}</p>
      <span class="card-art played-art" data-round-center-card-art="${side}" style="background-image: url('${getCardImage(card, options.variantMap ?? null)}')"></span>
    </div>
  `;
}

export function buildCenterRoundHeadline({ leftCard = null, rightCard = null, winner = null, war = false, noEffect = false } = {}) {
  if (war) {
    return "WAR";
  }

  if (noEffect || !leftCard || !rightCard || !winner) {
    return "NO EFFECT";
  }

  if (winner === "left") {
    return `${formatElement(leftCard).toUpperCase()} BEATS ${formatElement(rightCard).toUpperCase()}`;
  }

  if (winner === "right") {
    return `${formatElement(rightCard).toUpperCase()} BEATS ${formatElement(leftCard).toUpperCase()}`;
  }

  return "NO EFFECT";
}

export function renderCenterRoundResult(view = null) {
  if (!view) {
    return "";
  }

  const toneClass = normalizeToneClass(view.tone);
  const motionState = normalizeMotionState(view.motionState);
  const cardsHidden = Boolean(view.cardsHidden);
  const headline = String(view.headline ?? "").trim();
  const subtext = String(view.subtext ?? "").trim();
  const leftCardState = normalizeCardState(view.leftCardState);
  const rightCardState = normalizeCardState(view.rightCardState);
  const stackSweepSide = String(view.stackSweepSide ?? "").trim().toLowerCase();
  const clashLabel = getClashLabel(view);

  if (!headline && !view.leftCard && !view.rightCard && !cardsHidden) {
    return "";
  }

  return `
    <section
      class="round-center-result ${toneClass} motion-${motionState}"
      data-round-center-result="true"
      data-round-center-motion="${escapeHtml(motionState)}"
    >
      ${
        motionState === "war-resolved" && (stackSweepSide === "left" || stackSweepSide === "right")
          ? `<span class="round-center-result-stack-token round-center-result-stack-token-${escapeHtml(stackSweepSide)}" data-round-center-stack-sweep="${escapeHtml(stackSweepSide)}" aria-hidden="true"></span>`
          : ""
      }
      <div class="round-center-result-copy">
        <p class="round-center-result-kicker">Round Result</p>
        <h3 class="round-center-result-headline" data-round-center-headline="true">${escapeHtml(headline || "ROUND RESULT")}</h3>
        ${subtext ? `<p class="round-center-result-subtext">${escapeHtml(subtext)}</p>` : ""}
      </div>
      <div class="round-center-result-battle-row played-row compact-played-row ${cardsHidden ? "played-row-hotseat-hidden" : ""}" data-round-center-card-row="true">
        ${renderCenterResultCard(view.leftLabel ?? "Player", view.leftCard, {
          side: "left",
          faceDown: cardsHidden,
          cardState: leftCardState,
          variantMap: view.leftVariantMap ?? null,
          backImage: view.leftBackImage ?? null
        })}
        <div class="round-center-result-clash" data-round-center-clash="true" aria-hidden="true">
          <span class="round-center-result-clash-badge">${escapeHtml(clashLabel)}</span>
        </div>
        ${renderCenterResultCard(view.rightLabel ?? "Opponent", view.rightCard, {
          side: "right",
          faceDown: cardsHidden,
          cardState: rightCardState,
          variantMap: view.rightVariantMap ?? null,
          backImage: view.rightBackImage ?? null
        })}
      </div>
    </section>
  `;
}
