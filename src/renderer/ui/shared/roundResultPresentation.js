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

function renderCenterResultCard(label, card, options = {}) {
  const safeLabel = escapeHtml(label ?? "");

  if (options.faceDown) {
    return `
      <div class="played-slot is-facedown round-center-result-slot" data-round-center-card="${escapeHtml(options.side ?? "card")}">
        <p class="played-slot-label">${safeLabel}</p>
        <span class="card-art played-art card-art-facedown" style="background-image: url('${options.backImage ?? ASSET_CATALOG.cards.back}')"></span>
      </div>
    `;
  }

  if (!card) {
    return `
      <div class="played-slot round-center-result-slot" data-round-center-card="${escapeHtml(options.side ?? "card")}">
        <p class="played-slot-label">${safeLabel}: -</p>
      </div>
    `;
  }

  return `
    <div class="played-slot round-center-result-slot" data-round-center-card="${escapeHtml(options.side ?? "card")}">
      <p class="played-slot-label">${safeLabel}: ${formatElement(card)}</p>
      <span class="card-art played-art" style="background-image: url('${getCardImage(card, options.variantMap ?? null)}')"></span>
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
  const cardsHidden = Boolean(view.cardsHidden);
  const headline = String(view.headline ?? "").trim();
  const subtext = String(view.subtext ?? "").trim();

  if (!headline && !view.leftCard && !view.rightCard && !cardsHidden) {
    return "";
  }

  return `
    <section
      class="round-center-result ${toneClass}"
      data-round-center-result="true"
    >
      <div class="round-center-result-cards played-row compact-played-row ${cardsHidden ? "played-row-hotseat-hidden" : ""}">
        ${renderCenterResultCard(view.leftLabel ?? "Player", view.leftCard, {
          side: "left",
          faceDown: cardsHidden,
          variantMap: view.leftVariantMap ?? null,
          backImage: view.leftBackImage ?? null
        })}
        <div class="round-center-result-copy">
          <p class="round-center-result-kicker">Round Result</p>
          <h3 class="round-center-result-headline" data-round-center-headline="true">${escapeHtml(headline || "ROUND RESULT")}</h3>
          ${subtext ? `<p class="round-center-result-subtext">${escapeHtml(subtext)}</p>` : ""}
        </div>
        ${renderCenterResultCard(view.rightLabel ?? "Opponent", view.rightCard, {
          side: "right",
          faceDown: cardsHidden,
          variantMap: view.rightVariantMap ?? null,
          backImage: view.rightBackImage ?? null
        })}
      </div>
    </section>
  `;
}
