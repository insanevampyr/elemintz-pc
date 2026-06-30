import { BEATS_MAP, ELEMENTS, WAR_REQUIRED_CARDS, elementThatBeats } from "../../engine/index.js";

const EMPTY_COUNTS = Object.freeze({
  fire: 0,
  water: 0,
  earth: 0,
  wind: 0
});

function normalizeElement(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ELEMENTS.includes(normalized) ? normalized : null;
}

function normalizeCounts(counts = {}) {
  return Object.fromEntries(
    ELEMENTS.map((element) => [
      element,
      Math.max(0, Number(counts?.[element] ?? 0) || 0)
    ])
  );
}

function sumCounts(counts = EMPTY_COUNTS) {
  return ELEMENTS.reduce((total, element) => total + Math.max(0, Number(counts?.[element] ?? 0) || 0), 0);
}

function formatElementLabel(element) {
  const normalized = normalizeElement(element);
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : "";
}

function uniqueLegalElements(elements = []) {
  const seen = new Set();
  const legal = [];
  for (const value of Array.isArray(elements) ? elements : []) {
    const element = normalizeElement(value);
    if (element && !seen.has(element)) {
      seen.add(element);
      legal.push(element);
    }
  }
  return legal;
}

function buildCoverage(legalElements, opponentCounts) {
  return legalElements.map((element) => {
    const defeatsElement = BEATS_MAP[element];
    const beatenByElement = elementThatBeats(element);
    const defeats = Math.max(0, Number(opponentCounts[defeatsElement] ?? 0) || 0);
    const beatenBy = Math.max(0, Number(opponentCounts[beatenByElement] ?? 0) || 0);
    const tieExposure = Math.max(0, Number(opponentCounts[element] ?? 0) || 0);
    const opponentTotalConsidered = sumCounts(opponentCounts);
    const noEffectAgainst = ELEMENTS.reduce((total, opponentElement) => {
      if (
        opponentElement === defeatsElement ||
        opponentElement === beatenByElement ||
        opponentElement === element
      ) {
        return total;
      }
      return total + Math.max(0, Number(opponentCounts[opponentElement] ?? 0) || 0);
    }, 0);
    return {
      element,
      defeats,
      beatenBy,
      tieExposure,
      winsAgainst: defeats,
      losesTo: beatenBy,
      noEffectAgainst,
      tiesAgainst: tieExposure,
      opponentTotalConsidered,
      score: defeats - beatenBy - tieExposure
    };
  });
}

function getNoEffectElements(element, opponentCounts) {
  const normalizedElement = normalizeElement(element);
  if (!normalizedElement) {
    return [];
  }

  const defeatsElement = BEATS_MAP[normalizedElement];
  const beatenByElement = elementThatBeats(normalizedElement);
  return ELEMENTS.filter(
    (opponentElement) =>
      opponentElement !== normalizedElement &&
      opponentElement !== defeatsElement &&
      opponentElement !== beatenByElement &&
      Math.max(0, Number(opponentCounts?.[opponentElement] ?? 0) || 0) > 0
  );
}

function pluralizeCards(count) {
  return Number(count) === 1 ? "card" : "cards";
}

function formatCoverageReason(entry, suggestionKind) {
  if (!entry) {
    return null;
  }

  const elementLabel = formatElementLabel(entry.element);
  if (suggestionKind === "forced") {
    return `${elementLabel} is your only legal move. It beats ${entry.winsAgainst} remaining ${pluralizeCards(entry.winsAgainst)} but loses to ${entry.losesTo}.`;
  }

  if (suggestionKind === "safe" && entry.losesTo === 0 && entry.tiesAgainst === 0) {
    return `${elementLabel} defeats ${entry.winsAgainst} remaining ${pluralizeCards(entry.winsAgainst)}, loses to ${entry.losesTo}, and has no tie risk.`;
  }

  if (suggestionKind === "avoid" && entry.winsAgainst > 0) {
    const targetElement = BEATS_MAP[entry.element];
    const targetLabel = formatElementLabel(targetElement);
    return `Do not use ${elementLabel} now. Save it for their remaining ${targetLabel} cards.`;
  }

  if (suggestionKind === "avoid") {
    return `${elementLabel} loses to ${entry.losesTo} remaining ${pluralizeCards(entry.losesTo)} and has ${entry.tiesAgainst} tie risk.`;
  }

  return null;
}

function deriveForecastFatiguedElement(recentMoves = []) {
  const normalizedMoves = Array.isArray(recentMoves)
    ? recentMoves.map(normalizeElement).filter(Boolean)
    : [];
  const lastMove = normalizedMoves.at(-1) ?? null;
  const priorMove = normalizedMoves.at(-2) ?? null;
  return lastMove && lastMove === priorMove ? lastMove : null;
}

function formatElementList(elements = []) {
  const labels = elements.map(formatElementLabel).filter(Boolean);
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function buildFutureLegalElements({ countsAfterPlay, fatiguedElement }) {
  const availableElements = ELEMENTS.filter((element) => Math.max(0, Number(countsAfterPlay?.[element] ?? 0) || 0) > 0);
  if (!fatiguedElement || !availableElements.includes(fatiguedElement)) {
    return availableElements;
  }

  const alternatives = availableElements.filter((element) => element !== fatiguedElement);
  return alternatives.length > 0 ? alternatives : availableElements;
}

function buildFutureOptionForecast({
  legalElements,
  playerCounts,
  opponentCounts,
  recentPlayerMoves,
  suggestion,
  warActive
}) {
  const baseEntries = legalElements.map((element) => {
    const countsAfterPlay = { ...playerCounts };
    countsAfterPlay[element] = Math.max(0, Number(countsAfterPlay[element] ?? 0) - 1);
    const nextFatiguedElement = deriveForecastFatiguedElement([...recentPlayerMoves, element]);
    const futureLegalElements = buildFutureLegalElements({ countsAfterPlay, fatiguedElement: nextFatiguedElement });
    const createsFatigueNextTurn =
      nextFatiguedElement === element &&
      Math.max(0, Number(countsAfterPlay[element] ?? 0) || 0) > 0 &&
      futureLegalElements.every((futureElement) => futureElement !== element);
    const targetOpponentElement = BEATS_MAP[element];
    const targetOpponentRemaining = Math.max(0, Number(opponentCounts[targetOpponentElement] ?? 0) || 0);
    const visibleAnswer = targetOpponentRemaining > 0;
    const remainingCounterCopies = Math.max(0, Number(countsAfterPlay[element] ?? 0) || 0);
    const removesVisibleCounter = targetOpponentRemaining > 0 && remainingCounterCopies === 0;
    const reducesVisibleCounter = targetOpponentRemaining > 0 && remainingCounterCopies === 1;
    const futureOptionState =
      futureLegalElements.length > 1
        ? "multiple"
        : futureLegalElements.length === 1
          ? "single"
          : Math.max(0, Number(countsAfterPlay[element] ?? 0) || 0) > 0
            ? "fallback_only"
            : "none";

    return {
      element,
      createsFatigueNextTurn,
      fatiguedElementNextTurn: createsFatigueNextTurn ? element : null,
      futureLegalElements,
      futureOptionState,
      visibleAnswer,
      removesVisibleCounter,
      reducesVisibleCounter,
      targetOpponentElement,
      targetOpponentRemaining,
      alternatePreservesVisibleAnswer: false,
      preservingElements: []
    };
  });
  const entries = baseEntries.map((entry) => {
    const preservingElements = legalElements.filter((element) => {
      if (element === entry.element || !entry.visibleAnswer) {
        return false;
      }
      const remainingAfterAlternate = Math.max(0, Number(playerCounts?.[entry.element] ?? 0) || 0);
      return remainingAfterAlternate > 0;
    });
    return {
      ...entry,
      alternatePreservesVisibleAnswer: preservingElements.length > 0,
      preservingElements
    };
  });

  if (warActive) {
    return { entries, note: null, warning: null };
  }

  const suggestedEntry = entries.find((entry) => entry.element === suggestion?.element) ?? null;
  const selectedEntry =
    suggestedEntry ??
    entries.find((entry) => entry.removesVisibleCounter) ??
    entries.find((entry) => entry.createsFatigueNextTurn && entry.futureOptionState !== "multiple") ??
    null;

  if (!selectedEntry) {
    return { entries, note: null, warning: null };
  }

  const elementLabel = formatElementLabel(selectedEntry.element);
  const futureOptionsLabel = formatElementList(selectedEntry.futureLegalElements);
  const targetLabel = formatElementLabel(selectedEntry.targetOpponentElement);
  let note = null;
  let warning = null;

  const preservedAnswer = entries.find(
    (entry) =>
      entry.element !== selectedEntry.element &&
      entry.visibleAnswer &&
      entry.createsFatigueNextTurn &&
      Math.max(0, Number(playerCounts?.[entry.element] ?? 0) || 0) > 0
  );
  const preservedAnswerLabel = formatElementLabel(preservedAnswer?.element);
  const preservedAnswerTargetLabel = formatElementLabel(preservedAnswer?.targetOpponentElement);

  if (selectedEntry.removesVisibleCounter) {
    warning = `Using ${elementLabel} now leaves no other visible answer to their ${targetLabel} cards.`;
  } else if (selectedEntry.createsFatigueNextTurn && selectedEntry.visibleAnswer && selectedEntry.alternatePreservesVisibleAnswer) {
    warning = `Playing ${elementLabel} now will fatigue ${elementLabel} next turn. ${elementLabel} is still useful against their remaining ${targetLabel} cards.`;
  } else if (selectedEntry.createsFatigueNextTurn && selectedEntry.futureOptionState === "single") {
    warning = `Playing ${elementLabel} now will fatigue ${elementLabel} next turn. This leaves ${futureOptionsLabel} available next turn.`;
  } else if (selectedEntry.createsFatigueNextTurn && selectedEntry.futureOptionState !== "multiple") {
    warning = `Playing ${elementLabel} now will fatigue ${elementLabel} next turn. This may leave you with fewer answers next turn.`;
  } else if (selectedEntry.createsFatigueNextTurn && futureOptionsLabel) {
    note = `Playing ${elementLabel} now will fatigue ${elementLabel} next turn. This leaves ${futureOptionsLabel} available next turn.`;
  } else if (preservedAnswer && preservedAnswerLabel && preservedAnswerTargetLabel) {
    note = `Using ${elementLabel} keeps ${preservedAnswerLabel} available for their ${preservedAnswerTargetLabel} cards.`;
  } else if (selectedEntry.reducesVisibleCounter && selectedEntry.element !== suggestion?.element) {
    note = `Save ${elementLabel} for their remaining ${targetLabel} cards.`;
  }

  return { entries, note, warning };
}

function buildNoEffectGuidance({
  coverage,
  opponentCounts,
  futureOptionForecast,
  warActive
}) {
  const entries = (Array.isArray(coverage) ? coverage : [])
    .filter((entry) => entry.noEffectAgainst > 0)
    .map((entry) => ({
      element: entry.element,
      noEffectAgainst: entry.noEffectAgainst,
      noEffectElements: getNoEffectElements(entry.element, opponentCounts)
    }));

  if (
    warActive ||
    entries.length === 0 ||
    futureOptionForecast?.warning ||
    futureOptionForecast?.note
  ) {
    return { entries, note: null, warning: null };
  }

  const avoidsLossCandidate = coverage.find(
    (entry) =>
      entry.noEffectAgainst > 0 &&
      coverage.some((otherEntry) => otherEntry.element !== entry.element && otherEntry.losesTo > entry.losesTo)
  );
  const avoidsWarCandidate = coverage.find(
    (entry) =>
      entry.noEffectAgainst > 0 &&
      coverage.some((otherEntry) => otherEntry.element !== entry.element && otherEntry.tiesAgainst > entry.tiesAgainst)
  );
  const candidate = avoidsLossCandidate ?? avoidsWarCandidate ?? null;
  if (!candidate) {
    return { entries, note: null, warning: null };
  }

  const elementLabel = formatElementLabel(candidate.element);
  const noEffectElementLabel = formatElementLabel(getNoEffectElements(candidate.element, opponentCounts)[0]);
  if (!elementLabel || !noEffectElementLabel) {
    return { entries, note: null, warning: null };
  }

  if (avoidsLossCandidate) {
    return {
      entries,
      note: `${elementLabel} against ${noEffectElementLabel} has no immediate winner; it avoids direct loss risk but is not a guaranteed advantage.`,
      warning: null
    };
  }

  return {
    entries,
    note: `${elementLabel} against ${noEffectElementLabel} has no immediate winner; it is neither a win, loss, nor WAR.`,
    warning: null
  };
}

function withCoverageReason(suggestion, coverage, { warActive = false } = {}) {
  if (warActive || !suggestion || suggestion.kind === "none" || suggestion.reasonSource === "tactical") {
    return suggestion;
  }

  const entry = coverage.find((item) => item.element === suggestion.element);
  const reason = formatCoverageReason(entry, suggestion.kind);
  return reason ? { ...suggestion, reason } : suggestion;
}

function emptyTacticalPriority() {
  return {
    kind: "no_strong_read",
    element: null,
    avoidElement: null,
    losingToElement: null,
    targetOpponentElement: null,
    supportingMessage: null,
    message: "No strong read."
  };
}

function getDominatedLossWarning(coverage, preferredElement = null) {
  const dominatedLoss = [...(Array.isArray(coverage) ? coverage : [])]
    .filter((entry) => entry.element !== preferredElement && entry.losesTo > 0)
    .sort((a, b) => b.losesTo - a.losesTo || a.score - b.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element))[0] ?? null;
  if (!dominatedLoss) {
    return { avoidElement: null, losingToElement: null, message: null };
  }
  const losingToElement = elementThatBeats(dominatedLoss.element);
  return {
    avoidElement: dominatedLoss.element,
    losingToElement,
    message: `Do not use ${formatElementLabel(dominatedLoss.element)}; it loses to their remaining ${formatElementLabel(losingToElement)}.`
  };
}

function buildWarTacticalPriority({ coverage, available, opponentTotalCards }) {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return emptyTacticalPriority();
  }

  const requiredCards = Math.max(1, Number(WAR_REQUIRED_CARDS) || 1);
  const playerAvailableAfterTie = Math.max(0, Number(available?.player ?? 0) - 1);
  const opponentAvailableAfterTie = Math.max(0, Number(available?.opponent ?? opponentTotalCards) - 1);
  const opponentVisibleElements = coverage
    .flatMap((entry) => ELEMENTS.filter((element) => {
      if (entry.element !== element) {
        return false;
      }
      return entry.tiesAgainst > 0;
    }));
  const forcedWarElimination = coverage.find(
    (entry) =>
      opponentTotalCards > 0 &&
      entry.tiesAgainst === opponentTotalCards &&
      new Set(opponentVisibleElements).size <= 1 &&
      playerAvailableAfterTie >= requiredCards &&
      opponentAvailableAfterTie < requiredCards
  );
  if (forcedWarElimination) {
    const warning = getDominatedLossWarning(coverage, forcedWarElimination.element);
    return {
      kind: "forced_war_elimination",
      element: forcedWarElimination.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: forcedWarElimination.element,
      supportingMessage: warning.message,
      message: `Use ${formatElementLabel(forcedWarElimination.element)} now. The tie forces a WAR they cannot continue.`
    };
  }

  const directWin = coverage.find(
    (entry) =>
      opponentTotalCards > 0 &&
      entry.winsAgainst === opponentTotalCards &&
      entry.losesTo === 0 &&
      entry.tiesAgainst === 0 &&
      entry.noEffectAgainst === 0
  );
  if (directWin) {
    const warning = getDominatedLossWarning(coverage, directWin.element);
    return {
      kind: "direct_win",
      element: directWin.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: BEATS_MAP[directWin.element] ?? null,
      supportingMessage: warning.message,
      message: `Use ${formatElementLabel(directWin.element)} now for a direct win.`
    };
  }

  const ranked = [...coverage].sort((a, b) => {
    const lossDelta = a.losesTo - b.losesTo;
    if (lossDelta !== 0) {
      return lossDelta;
    }
    const tieDelta = a.tiesAgainst - b.tiesAgainst;
    if (tieDelta !== 0 && (available?.player <= 1 || available?.opponent <= 1)) {
      return tieDelta;
    }
    return b.score - a.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element);
  });
  const best = ranked[0];
  const nextBest = ranked[1];
  if (!best || !nextBest) {
    return emptyTacticalPriority();
  }

  const materiallyAvoidsLoss = best.losesTo === 0 && nextBest.losesTo > 0;
  const materiallyAvoidsTie = best.tiesAgainst === 0 && nextBest.tiesAgainst > 0 && (available?.player <= 1 || available?.opponent <= 1);
  const materiallyBetterCoverage = best.score - nextBest.score >= 2 && (best.winsAgainst > nextBest.winsAgainst || best.losesTo < nextBest.losesTo);
  if (materiallyAvoidsLoss || materiallyAvoidsTie || materiallyBetterCoverage) {
    const warning = getDominatedLossWarning(coverage, best.element);
    const avoidedElement = warning.losingToElement ?? elementThatBeats(nextBest.element);
    const message = materiallyAvoidsLoss && avoidedElement
      ? `Use ${formatElementLabel(best.element)} now. It avoids their remaining ${formatElementLabel(avoidedElement)}.`
      : `Use ${formatElementLabel(best.element)} now. It gives the safest visible outcome.`;
    return {
      kind: "coverage_based",
      element: best.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: BEATS_MAP[best.element] ?? null,
      supportingMessage: warning.message,
      message
    };
  }

  return emptyTacticalPriority();
}

function buildTacticalPriority({ coverage, available, opponentTotalCards, playerCounts, warActive }) {
  if (warActive) {
    return buildWarTacticalPriority({ coverage, available, opponentTotalCards });
  }

  if (!Array.isArray(coverage) || coverage.length === 0) {
    return emptyTacticalPriority();
  }

  const directWin = coverage.find(
    (entry) =>
      opponentTotalCards > 0 &&
      entry.winsAgainst === opponentTotalCards &&
      entry.losesTo === 0 &&
      entry.tiesAgainst === 0 &&
      entry.noEffectAgainst === 0
  );
  if (directWin) {
    const warning = getDominatedLossWarning(coverage, directWin.element);
    return {
      kind: "direct_win",
      element: directWin.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: BEATS_MAP[directWin.element] ?? null,
      supportingMessage: warning.message,
      message: `Use ${formatElementLabel(directWin.element)} now for a direct win.`
    };
  }

  const requiredCards = Math.max(1, Number(WAR_REQUIRED_CARDS) || 1);
  const playerAvailableAfterTie = Math.max(0, Number(available?.player ?? 0) - 1);
  const opponentAvailableAfterTie = Math.max(0, Number(available?.opponent ?? opponentTotalCards) - 1);
  const forcedWarElimination = coverage.find(
    (entry) =>
      entry.tiesAgainst > 0 &&
      playerAvailableAfterTie >= requiredCards &&
      opponentAvailableAfterTie < requiredCards
  );
  if (forcedWarElimination) {
    const warning = getDominatedLossWarning(coverage, forcedWarElimination.element);
    return {
      kind: "forced_war_elimination",
      element: forcedWarElimination.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: forcedWarElimination.element,
      supportingMessage: warning.message,
      message: `Use ${formatElementLabel(forcedWarElimination.element)} now. The tie forces a WAR they cannot continue.`
    };
  }

  const sortedBest = [...coverage].sort((a, b) => b.score - a.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element));
  const sortedWorst = [...coverage].sort((a, b) => a.score - b.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element));
  const best = sortedBest[0];
  const nextBest = sortedBest[1];
  const worst = sortedWorst[0];
  if (worst?.losesTo > 0 && best && best.element !== worst.element && best.score - worst.score >= 2) {
    const losingToElement = elementThatBeats(worst.element);
    return {
      kind: "avoid_dominated_loss",
      element: best.element,
      avoidElement: worst.element,
      losingToElement,
      targetOpponentElement: null,
      supportingMessage: `Do not use ${formatElementLabel(worst.element)}; it loses to their remaining ${formatElementLabel(losingToElement)}.`,
      message: `Use ${formatElementLabel(best.element)} now. Do not use ${formatElementLabel(worst.element)}; it loses to their remaining ${formatElementLabel(losingToElement)}.`
    };
  }

  const preservationCandidate = coverage.find((entry) => {
    const playerCount = Math.max(0, Number(playerCounts?.[entry.element] ?? 0) || 0);
    const targetRemaining = entry.winsAgainst;
    if (playerCount !== 1 || targetRemaining <= 0) {
      return false;
    }
    const bestVisibleScore = Math.max(...coverage.map((item) => item.score));
    if (bestVisibleScore - entry.score >= 2) {
      return false;
    }
    return coverage.some(
      (otherEntry) =>
        otherEntry.element !== entry.element &&
        otherEntry.score >= entry.score - 1 &&
        otherEntry.losesTo <= entry.losesTo &&
        otherEntry.tiesAgainst <= entry.tiesAgainst
    );
  });
  if (preservationCandidate) {
    const targetOpponentElement = BEATS_MAP[preservationCandidate.element];
    const preferredAlternative = [...coverage]
      .filter((entry) => entry.element !== preservationCandidate.element)
      .sort((a, b) => b.score - a.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element))[0];
    return {
      kind: "preservation_based",
      element: preferredAlternative?.element ?? null,
      avoidElement: preservationCandidate.element,
      losingToElement: null,
      targetOpponentElement,
      supportingMessage: `Save ${formatElementLabel(preservationCandidate.element)} for their remaining ${formatElementLabel(targetOpponentElement)} cards.`,
      message: preferredAlternative?.element
        ? `Use ${formatElementLabel(preferredAlternative.element)} now. It preserves your answer to their remaining ${formatElementLabel(targetOpponentElement)}.`
        : `Save ${formatElementLabel(preservationCandidate.element)} for their remaining ${formatElementLabel(targetOpponentElement)} cards.`
    };
  }

  const materiallyAvoidsLoss = best?.losesTo === 0 && nextBest?.losesTo > 0;
  const materiallyAvoidsTie = best?.tiesAgainst === 0 && nextBest?.tiesAgainst > 0;
  const materiallyBetterCoverage =
    best && nextBest && best.score - nextBest.score >= 2 && (best.winsAgainst > nextBest.winsAgainst || best.losesTo < nextBest.losesTo);
  if (best && nextBest && (materiallyAvoidsLoss || materiallyAvoidsTie || materiallyBetterCoverage || best.score > 0)) {
    const warning = getDominatedLossWarning(coverage, best.element);
    const avoidedElement = warning.losingToElement ?? elementThatBeats(nextBest.element);
    const message = materiallyAvoidsLoss && avoidedElement
      ? `Use ${formatElementLabel(best.element)} now. It avoids their remaining ${formatElementLabel(avoidedElement)}.`
      : `Use ${formatElementLabel(best.element)} now. It gives the safest visible outcome.`;
    return {
      kind: "coverage_based",
      element: best.element,
      avoidElement: warning.avoidElement,
      losingToElement: warning.losingToElement,
      targetOpponentElement: BEATS_MAP[best.element] ?? null,
      supportingMessage: warning.message,
      message
    };
  }

  return emptyTacticalPriority();
}

function buildOutcomeConfidence({ coverage, suggestion, warActive }) {
  const empty = { kind: "none", message: null, element: null };
  if (warActive || !Array.isArray(coverage) || coverage.length === 0) {
    return empty;
  }

  const sortedBest = [...coverage].sort((a, b) => b.score - a.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element));
  const best = sortedBest[0];
  const bestLabel = formatElementLabel(best?.element);
  const guaranteed = coverage.find(
    (entry) =>
      entry.winsAgainst > 0 &&
      entry.losesTo === 0 &&
      entry.tiesAgainst === 0 &&
      entry.noEffectAgainst === 0
  );
  if (guaranteed) {
    return {
      kind: "guaranteed_win",
      message: "Guaranteed win visible.",
      element: guaranteed.element
    };
  }

  if (coverage.length === 1 && best) {
    return {
      kind: "forced_risk",
      message: "Forced risk: this is your only legal move and it may be beaten.",
      element: best.element
    };
  }

  const noSafeResponse = coverage.every((entry) => entry.winsAgainst <= entry.losesTo);
  if (noSafeResponse) {
    return {
      kind: "no_safe_response",
      message: "No safe response is visible.",
      element: null
    };
  }

  if (
    best?.winsAgainst > best?.losesTo &&
    best?.winsAgainst > 0 &&
    best?.losesTo === 0 &&
    best?.tiesAgainst <= 1 &&
    best?.noEffectAgainst <= 1 &&
    bestLabel
  ) {
    return {
      kind: "strong_position",
      message: `Strong position: most remaining cards lose to ${bestLabel}.`,
      element: best.element
    };
  }

  const hasMeaningfulExposure = best && (best.losesTo > 0 || best.tiesAgainst > 0 || best.noEffectAgainst > 0);
  if (best?.winsAgainst > 0 && hasMeaningfulExposure) {
    return {
      kind: "mixed_outcome",
      message: "Mixed outcome: this can win, but losses and tie risk remain.",
      element: best.element
    };
  }

  if (best?.winsAgainst > 0) {
    return {
      kind: "mixed_outcome",
      message: "Mixed outcome: this can win, but losses and tie risk remain.",
      element: best.element
    };
  }

  return empty;
}

function emptyPatternRecognition() {
  return {
    repeatedElementPattern: null,
    responsePattern: null,
    tieAvoidancePattern: null,
    avoidancePattern: null,
    confidence: "none",
    sampleCount: 0,
    message: null
  };
}

function countByElement(elements = []) {
  return elements.reduce((counts, element) => {
    const normalized = normalizeElement(element);
    if (normalized) {
      counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function buildPatternRecognition({ visibleHistory, opponentCounts, opponentTotalCards, warActive }) {
  if (warActive || !Array.isArray(visibleHistory)) {
    return emptyPatternRecognition();
  }

  const revealed = visibleHistory
    .map((entry) => ({
      playerElement: normalizeElement(entry?.p1Card),
      opponentElement: normalizeElement(entry?.p2Card)
    }))
    .filter((entry) => entry.opponentElement);
  if (revealed.length < 3) {
    return emptyPatternRecognition();
  }

  const opponentMoves = revealed.map((entry) => entry.opponentElement);
  const opponentMoveCounts = countByElement(opponentMoves);
  const repeatedElement = ELEMENTS
    .map((element) => ({
      element,
      count: opponentMoveCounts[element] ?? 0,
      currentRemaining: Math.max(0, Number(opponentCounts?.[element] ?? 0) || 0)
    }))
    .filter((entry) => entry.count >= 3 && entry.count / revealed.length >= 0.6 && entry.currentRemaining > 0)
    .sort((a, b) => b.count - a.count || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element))[0] ?? null;
  if (repeatedElement) {
    const message = `They have often used ${formatElementLabel(repeatedElement.element)} when it was available.`;
    return {
      ...emptyPatternRecognition(),
      repeatedElementPattern: {
        element: repeatedElement.element,
        sampleCount: revealed.length,
        observedCount: repeatedElement.count,
        message
      },
      confidence: "moderate",
      sampleCount: revealed.length,
      message
    };
  }

  const responseCandidates = [];
  for (const playerElement of ELEMENTS) {
    const responses = revealed.filter((entry) => entry.playerElement === playerElement && entry.opponentElement);
    if (responses.length < 3) {
      continue;
    }
    const responseCounts = countByElement(responses.map((entry) => entry.opponentElement));
    const bestResponse = ELEMENTS
      .map((element) => ({ element, count: responseCounts[element] ?? 0 }))
      .filter((entry) => entry.count >= 3 && entry.count / responses.length >= 0.6)
      .sort((a, b) => b.count - a.count || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element))[0] ?? null;
    if (bestResponse) {
      responseCandidates.push({
        playerElement,
        responseElement: bestResponse.element,
        sampleCount: responses.length,
        observedCount: bestResponse.count
      });
    }
  }
  const responsePattern = responseCandidates
    .sort((a, b) => b.observedCount - a.observedCount || ELEMENTS.indexOf(a.playerElement) - ELEMENTS.indexOf(b.playerElement))[0] ?? null;
  if (responsePattern) {
    const message = `They have tended to answer ${formatElementLabel(responsePattern.playerElement)} with ${formatElementLabel(responsePattern.responseElement)}.`;
    return {
      ...emptyPatternRecognition(),
      responsePattern: {
        ...responsePattern,
        message
      },
      confidence: "moderate",
      sampleCount: responsePattern.sampleCount,
      message
    };
  }

  const recentLowCard = revealed.slice(-3);
  const tieAvoidCount = recentLowCard.filter(
    (entry) => entry.playerElement && entry.opponentElement && entry.playerElement !== entry.opponentElement
  ).length;
  if (opponentTotalCards <= 3 && recentLowCard.length >= 3 && tieAvoidCount >= 3) {
    const message = "They seem to avoid likely ties when low on cards.";
    return {
      ...emptyPatternRecognition(),
      tieAvoidancePattern: {
        sampleCount: recentLowCard.length,
        observedCount: tieAvoidCount,
        message
      },
      confidence: "cautious",
      sampleCount: recentLowCard.length,
      message
    };
  }

  const strongestObservedCount = Math.max(...ELEMENTS.map((element) => opponentMoveCounts[element] ?? 0));
  const avoidancePattern = ELEMENTS
    .map((element) => ({
      element,
      count: opponentMoveCounts[element] ?? 0,
      currentRemaining: Math.max(0, Number(opponentCounts?.[element] ?? 0) || 0)
    }))
    .filter(
      (entry) =>
        revealed.length >= 5 &&
        strongestObservedCount >= 3 &&
        entry.count / revealed.length <= 0.2 &&
        entry.currentRemaining > 0
    )
    .sort((a, b) => a.count - b.count || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element))[0] ?? null;
  if (avoidancePattern) {
    const message = `They have rarely used ${formatElementLabel(avoidancePattern.element)} when other options were available.`;
    return {
      ...emptyPatternRecognition(),
      avoidancePattern: {
        element: avoidancePattern.element,
        sampleCount: revealed.length,
        observedCount: avoidancePattern.count,
        message
      },
      confidence: "cautious",
      sampleCount: revealed.length,
      message
    };
  }

  return emptyPatternRecognition();
}

function buildWarSurvival({ warActive, available, war }) {
  if (!warActive) {
    return null;
  }

  const playerAvailableCards = Math.max(0, Number(available?.player ?? 0) || 0);
  const opponentAvailableCards = Math.max(0, Number(available?.opponent ?? 0) || 0);
  const requiredCards = Math.max(1, Number(WAR_REQUIRED_CARDS) || 1);
  const pileCount = Math.max(0, Number(war?.pileCount ?? 0) || 0);
  const commitmentTotals = {
    player: Math.max(0, Number(war?.commitmentTotals?.player ?? 0) || 0),
    opponent: Math.max(0, Number(war?.commitmentTotals?.opponent ?? 0) || 0)
  };
  const commitmentTotal = commitmentTotals.player + commitmentTotals.opponent;
  const playerCanContinueCurrentWar = playerAvailableCards >= requiredCards;
  const opponentCanContinueCurrentWar = opponentAvailableCards >= requiredCards;
  const playerCanSurviveAnotherTie = playerAvailableCards - requiredCards >= requiredCards;
  const opponentCanSurviveAnotherTie = opponentAvailableCards - requiredCards >= requiredCards;
  const playerCardEdge = playerAvailableCards > opponentAvailableCards;
  const opponentCardEdge = opponentAvailableCards > playerAvailableCards;
  let riskLevel = "stable";
  let message = "Both players can continue.";

  if (!playerCanContinueCurrentWar && !opponentCanContinueCurrentWar) {
    riskLevel = "critical";
    message = "Neither player can continue this WAR.";
  } else if (!playerCanContinueCurrentWar) {
    riskLevel = "critical";
    message = "You cannot continue this WAR.";
  } else if (!opponentCanContinueCurrentWar) {
    riskLevel = "opponent_pressure";
    message = "Opponent cannot continue another WAR after this commitment.";
  } else if (!playerCanSurviveAnotherTie) {
    riskLevel = "danger";
    message = "Another tie could eliminate you.";
  } else if (!opponentCanSurviveAnotherTie) {
    riskLevel = "opponent_pressure";
    message = "Opponent cannot continue another WAR after this commitment.";
  } else if (playerCardEdge) {
    riskLevel = "edge";
    message = "You have a card-count edge after the current commitment.";
  } else if (opponentCardEdge) {
    riskLevel = "thin";
    message = "Both players can continue, but your margin is thin.";
  } else if (pileCount >= 4 || commitmentTotal >= 4) {
    riskLevel = "pot_pressure";
    message = "The WAR pot is large; avoid another tie if possible.";
  }

  return {
    playerAvailableCards,
    opponentAvailableCards,
    pot: pileCount,
    commitmentTotal,
    commitmentTotals,
    requiredCards,
    playerCanContinueCurrentWar,
    opponentCanContinueCurrentWar,
    playerCanSurviveAnotherTie,
    opponentCanSurviveAnotherTie,
    playerCardEdge,
    opponentCardEdge,
    riskLevel,
    message
  };
}

function buildTacticalRead({
  opponentCounts,
  opponentFatigueElement,
  coverage,
  recentOpponentMoves,
  warActive = false,
  tacticalPriority,
  warSurvival
}) {
  const read = [];
  for (const element of ELEMENTS) {
    if (opponentCounts[element] === 0) {
      read.push(`${element} unavailable`);
    }
  }

  const largestCount = Math.max(...ELEMENTS.map((element) => opponentCounts[element]));
  const largestElements = ELEMENTS.filter((element) => opponentCounts[element] === largestCount && largestCount > 0);
  if (largestElements.length > 0) {
    read.push(`${largestElements.join("/")} most remaining`);
  }

  if (opponentFatigueElement) {
    read.push(`Their ${formatElementLabel(opponentFatigueElement)} is resting this turn.`);
  }

  const recent = Array.isArray(recentOpponentMoves)
    ? recentOpponentMoves.map(normalizeElement).filter(Boolean).slice(-3)
    : [];
  const repeatedRecent = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : null;
  if (repeatedRecent) {
    read.push(`${repeatedRecent} repeat pattern likely based on recent cards`);
  }

  const tieRisk = coverage.find((entry) => entry.tieExposure > 0);
  const tieMaterial =
    tacticalPriority?.kind === "forced_war_elimination" ||
    (warActive && (
      warSurvival?.playerCanSurviveAnotherTie === false ||
      warSurvival?.opponentCanSurviveAnotherTie === false ||
      warSurvival?.playerCanContinueCurrentWar === false ||
      warSurvival?.opponentCanContinueCurrentWar === false
    ));
  if (tieRisk && tieMaterial) {
    read.push("Tie risk still available");
  }

  return read.length > 0 ? read : ["No strong read"];
}

function chooseSuggestion({ coverage, opponentTotalCards, tacticalPriority }) {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return {
      kind: "none",
      element: null,
      reason: "No legal move available.",
      confidence: "none"
    };
  }

  if (tacticalPriority?.kind === "direct_win" || tacticalPriority?.kind === "forced_war_elimination") {
    return {
      kind: "safe",
      element: tacticalPriority.element,
      reason: tacticalPriority.message,
      confidence: "certain",
      reasonSource: "tactical"
    };
  }

  if (tacticalPriority?.kind === "coverage_based" && tacticalPriority.message && tacticalPriority.element) {
    const priorityCoverage = coverage.find((entry) => entry.element === tacticalPriority.element);
    return {
      kind:
        priorityCoverage?.winsAgainst > 0 &&
        priorityCoverage?.losesTo === 0 &&
        priorityCoverage?.tiesAgainst === 0
          ? "safe"
          : "use",
      element: tacticalPriority.element,
      reason: tacticalPriority.message,
      confidence: "strong",
      reasonSource: "tactical"
    };
  }

  if (tacticalPriority?.kind === "avoid_dominated_loss") {
    if (tacticalPriority.element && tacticalPriority.message) {
      return {
        kind: "use",
        element: tacticalPriority.element,
        reason: tacticalPriority.message,
        confidence: "strong",
        reasonSource: "tactical"
      };
    }
    return {
      kind: "avoid",
      element: tacticalPriority.avoidElement,
      reason: tacticalPriority.message,
      confidence: "strong",
      reasonSource: "tactical"
    };
  }

  if (tacticalPriority?.kind === "preservation_based") {
    if (tacticalPriority.element && tacticalPriority.message) {
      return {
        kind: "use",
        element: tacticalPriority.element,
        reason: tacticalPriority.message,
        confidence: "likely",
        reasonSource: "tactical"
      };
    }
    return {
      kind: "avoid",
      element: tacticalPriority.avoidElement,
      reason: tacticalPriority.message,
      confidence: "likely",
      reasonSource: "tactical"
    };
  }

  if (coverage.length === 1) {
    return {
      kind: "forced",
      element: coverage[0].element,
      reason: "Only legal move available.",
      confidence: "certain"
    };
  }

  const sortedBest = [...coverage].sort((a, b) => b.score - a.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element));
  const best = sortedBest[0];
  const nextBest = sortedBest[1];
  if (
    opponentTotalCards > 0 &&
    best.score >= 2 &&
    best.score - nextBest.score >= 2 &&
    best.losesTo === 0 &&
    best.tiesAgainst === 0
  ) {
    return {
      kind: "safe",
      element: best.element,
      reason: "Likely based on remaining cards.",
      confidence: "likely"
    };
  }

  const sortedWorst = [...coverage].sort((a, b) => a.score - b.score || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element));
  const worst = sortedWorst[0];
  const nextWorst = sortedWorst[1];
  if (opponentTotalCards > 0 && worst.score <= -2 && nextWorst.score - worst.score >= 2) {
    return {
      kind: "avoid",
      element: worst.element,
      reason: "Tie risk or counter pressure is higher.",
      confidence: "likely"
    };
  }

  return {
    kind: "none",
    element: null,
    reason: formatNoStrongReadReason(best, nextBest),
    confidence: "none"
  };
}

function formatNoStrongReadReason(best, nextBest) {
  if (!best || !nextBest) {
    return "No strong read.";
  }
  const bestLabel = formatElementLabel(best.element);
  const nextLabel = formatElementLabel(nextBest.element);
  if (!bestLabel || !nextLabel) {
    return "No strong read.";
  }
  if (best.losesTo > 0 && nextBest.losesTo > 0) {
    return `${bestLabel} and ${nextLabel} both expose you to visible counters.`;
  }
  if (best.tiesAgainst > 0 && nextBest.tiesAgainst > 0) {
    return `${bestLabel} and ${nextLabel} both carry visible tie risk.`;
  }
  return `${bestLabel} and ${nextLabel} have comparable visible coverage.`;
}

function buildRiskNote({ coverage, suggestion, warActive, available, tieExposureTotal }) {
  if (warActive && available.player <= 1 && tieExposureTotal > 0) {
    return "Tie risk: another WAR continuation could eliminate you.";
  }
  if (warActive && available.opponent <= 1) {
    return "Opponent low-card pressure is visible.";
  }

  if (!Array.isArray(coverage) || coverage.length === 0) {
    return null;
  }

  if (suggestion?.kind === "forced") {
    const forcedCoverage = coverage.find((entry) => entry.element === suggestion.element) ?? coverage[0];
    if (forcedCoverage.score < 0 || forcedCoverage.beatenBy > forcedCoverage.defeats) {
      return "This forced move may be beaten.";
    }
    return null;
  }

  if (coverage.every((entry) => entry.score < 0)) {
    return "Every legal option is vulnerable to their remaining cards.";
  }

  return null;
}

function emptyStrategyPlan() {
  return {
    kind: "none",
    protectingElement: null,
    pressureElement: null,
    bridgeElement: null,
    targetOpponentElement: null,
    message: "No strong control plan.",
    nextStep: null
  };
}

function isMeaningfulProtectingSupply(protectingElement, targetElement, playerCounts) {
  const protectingCount = Math.max(0, Number(playerCounts?.[protectingElement] ?? 0) || 0);
  const pressureCount = Math.max(0, Number(playerCounts?.[targetElement] ?? 0) || 0);
  return protectingCount >= 2 && protectingCount > pressureCount;
}

function buildPressureOpportunity({ targetElement, playerCounts, opponentCounts, legalElements }) {
  const protectingElement = elementThatBeats(targetElement);
  const pressureElement = targetElement;
  const targetCount = Math.max(0, Number(opponentCounts?.[targetElement] ?? 0) || 0);
  if (targetCount <= 0 || !isMeaningfulProtectingSupply(protectingElement, targetElement, playerCounts)) {
    return null;
  }

  return {
    protectingElement,
    pressureElement,
    targetOpponentElement: targetElement,
    targetCount,
    pressureLegal: legalElements.includes(pressureElement)
  };
}

function getPressureOpportunities({ playerCounts, opponentCounts, legalElements }) {
  return ELEMENTS
    .map((targetElement) => buildPressureOpportunity({ targetElement, playerCounts, opponentCounts, legalElements }))
    .filter(Boolean)
    .sort((a, b) => b.targetCount - a.targetCount || ELEMENTS.indexOf(a.targetOpponentElement) - ELEMENTS.indexOf(b.targetOpponentElement));
}

function chooseBridgeElement({ legalElements, pressureElement, coverage }) {
  const bridgeOptions = coverage
    .filter((entry) => entry.element !== pressureElement && legalElements.includes(entry.element))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.tieExposure - b.tieExposure ||
        ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element)
    );

  return bridgeOptions[0]?.element ?? legalElements.find((element) => element !== pressureElement) ?? null;
}

function buildStrategyPlan({
  playerCounts,
  opponentCounts,
  legalElements,
  playerFatigueElement,
  coverage,
  warActive,
  riskNote
}) {
  if (warActive && riskNote) {
    return {
      ...emptyStrategyPlan(),
      message: "WAR pressure is the priority.",
      nextStep: "Resolve the immediate tie risk before planning pressure."
    };
  }

  const exhaustedControlTargets = ELEMENTS.filter(
    (targetElement) =>
      opponentCounts[targetElement] === 0 &&
      isMeaningfulProtectingSupply(elementThatBeats(targetElement), targetElement, playerCounts)
  );
  const pressureOpportunities = getPressureOpportunities({ playerCounts, opponentCounts, legalElements });

  if (exhaustedControlTargets.length > 0 && pressureOpportunities.length > 0) {
    const exhaustedTarget = exhaustedControlTargets[0];
    const nextOpportunity = pressureOpportunities[0];
    return {
      kind: "shift",
      protectingElement: nextOpportunity.protectingElement,
      pressureElement: nextOpportunity.pressureElement,
      bridgeElement: null,
      targetOpponentElement: nextOpportunity.targetOpponentElement,
      message: `${exhaustedTarget} is exhausted. Shift pressure toward ${nextOpportunity.targetOpponentElement} while preserving ${nextOpportunity.protectingElement}.`,
      nextStep: `Use ${nextOpportunity.pressureElement} pressure when it stays legal.`
    };
  }

  const blockedOpportunity = ELEMENTS
    .map((targetElement) => buildPressureOpportunity({
      targetElement,
      playerCounts,
      opponentCounts,
      legalElements: ELEMENTS
    }))
    .filter(Boolean)
    .find((opportunity) => opportunity.pressureElement === playerFatigueElement && !legalElements.includes(opportunity.pressureElement));
  if (blockedOpportunity) {
    const bridgeElement = chooseBridgeElement({
      legalElements,
      pressureElement: blockedOpportunity.pressureElement,
      coverage
    });
    if (bridgeElement) {
      return {
        kind: "bridge",
        protectingElement: blockedOpportunity.protectingElement,
        pressureElement: blockedOpportunity.pressureElement,
        bridgeElement,
        targetOpponentElement: blockedOpportunity.targetOpponentElement,
        message: `${blockedOpportunity.pressureElement} is resting from fatigue. Use ${bridgeElement} as a bridge, then reassess ${blockedOpportunity.pressureElement} pressure next turn.`,
        nextStep: `Return to ${blockedOpportunity.pressureElement} pressure if it remains safe.`
      };
    }
  }

  if (pressureOpportunities.length > 0) {
    const opportunity = pressureOpportunities.find((entry) => entry.pressureLegal) ?? null;
    if (opportunity) {
      return {
        kind: "pressure",
        protectingElement: opportunity.protectingElement,
        pressureElement: opportunity.pressureElement,
        bridgeElement: null,
        targetOpponentElement: opportunity.targetOpponentElement,
        message: `Control plan: pressure ${opportunity.targetOpponentElement}. Your ${opportunity.protectingElement} supply protects this route while ${opportunity.targetOpponentElement} remains in their hand.`,
        nextStep: `Keep ${opportunity.protectingElement} available as protection.`
      };
    }
  }

  const preserveElement = ELEMENTS.find((element) => {
    const playerCount = Math.max(0, Number(playerCounts?.[element] ?? 0) || 0);
    const threatElement = BEATS_MAP[element];
    const threatCount = Math.max(0, Number(opponentCounts?.[threatElement] ?? 0) || 0);
    return playerCount === 1 && threatCount >= 2;
  });
  if (preserveElement) {
    const threatElement = BEATS_MAP[preserveElement];
    return {
      kind: "preserve",
      protectingElement: preserveElement,
      pressureElement: null,
      bridgeElement: null,
      targetOpponentElement: threatElement,
      message: `Preserve ${preserveElement}. It is your limited answer to their remaining ${threatElement} cards.`,
      nextStep: `Avoid spending ${preserveElement} casually.`
    };
  }

  return emptyStrategyPlan();
}

export function evaluateTrainingCoach(snapshot = {}) {
  if (snapshot?.trainingActive !== true) {
    return null;
  }

  const opponentRemainingByElement = normalizeCounts(snapshot.opponentRemainingByElement);
  const playerRemainingByElement = normalizeCounts(snapshot.playerRemainingByElement);
  const opponentTotalCards = sumCounts(opponentRemainingByElement);
  const legalElements = uniqueLegalElements(snapshot.legalPlayableElements);
  const playerFatigueElement = normalizeElement(snapshot.fatigue?.playerBlockedElement);
  const opponentFatigueElement = normalizeElement(snapshot.fatigue?.opponentBlockedElement);
  const opponentCoverageCounts = {
    ...opponentRemainingByElement,
    ...(opponentFatigueElement ? { [opponentFatigueElement]: 0 } : {})
  };
  const opponentTotalConsidered = sumCounts(opponentCoverageCounts);
  const recentPlayerMoves = Array.isArray(snapshot.recentPlayerMoves)
    ? snapshot.recentPlayerMoves.map(normalizeElement).filter(Boolean).slice(-6)
    : [];
  const coverage = buildCoverage(legalElements, opponentCoverageCounts);
  const phase = snapshot.phase === "war" ? "war" : "normal";
  const available = {
    player: Math.max(0, Number(snapshot.availableCards?.player ?? 0) || 0),
    opponent: Math.max(0, Number(snapshot.availableCards?.opponent ?? opponentTotalCards) || 0)
  };
  const warActive = phase === "war";
  const warSurvival = buildWarSurvival({
    warActive,
    available,
    war: snapshot.war
  });
  const tacticalPriority = buildTacticalPriority({
    coverage,
    available,
    opponentTotalCards: opponentTotalConsidered,
    playerCounts: playerRemainingByElement,
    warActive
  });
  const suggestion = withCoverageReason(
    chooseSuggestion({ coverage, opponentTotalCards: opponentTotalConsidered, tacticalPriority }),
    coverage,
    { warActive }
  );
  const outcomeConfidence = buildOutcomeConfidence({ coverage, suggestion, warActive });
  const tieExposureTotal = coverage.reduce((total, entry) => total + entry.tieExposure, 0);
  const riskNote = buildRiskNote({ coverage, suggestion, warActive, available, tieExposureTotal });
  const futureOptionForecast = buildFutureOptionForecast({
    legalElements,
    playerCounts: playerRemainingByElement,
    opponentCounts: opponentRemainingByElement,
    recentPlayerMoves,
    suggestion,
    warActive
  });
  const noEffectGuidance = buildNoEffectGuidance({
    coverage,
    opponentCounts: opponentRemainingByElement,
    futureOptionForecast,
    warActive
  });
  const patternRecognition = buildPatternRecognition({
    visibleHistory: snapshot.visibleHistory,
    opponentCounts: opponentRemainingByElement,
    opponentTotalCards,
    warActive
  });
  const strategyPlan = buildStrategyPlan({
    playerCounts: playerRemainingByElement,
    opponentCounts: opponentRemainingByElement,
    legalElements,
    playerFatigueElement,
    coverage,
    warActive,
    riskNote
  });
  const tacticalSolved =
    tacticalPriority.kind === "direct_win" ||
    tacticalPriority.kind === "forced_war_elimination";

  return {
    opponentRemainingByElement,
    playerRemainingByElement,
    opponentTotalCards,
    legalPlayableElements: legalElements,
    fatigue: {
      playerBlockedElement: playerFatigueElement,
      opponentBlockedElement: opponentFatigueElement
    },
    tacticalRead: buildTacticalRead({
      opponentCounts: opponentRemainingByElement,
      opponentFatigueElement,
      coverage,
      recentOpponentMoves: snapshot.recentOpponentMoves,
      warActive,
      tacticalPriority,
      warSurvival
    }),
    coverage: coverage.map(({ element, defeats, beatenBy, tieExposure }) => ({
      element,
      defeats,
      beatenBy,
      tieExposure
    })),
    outcomeCoverage: coverage.map(({
      element,
      winsAgainst,
      losesTo,
      noEffectAgainst,
      tiesAgainst,
      opponentTotalConsidered
    }) => ({
      element,
      winsAgainst,
      losesTo,
      noEffectAgainst,
      tiesAgainst,
      opponentTotalConsidered
    })),
    futureOptionForecast: tacticalSolved
      ? { entries: futureOptionForecast.entries, note: null, warning: null }
      : futureOptionForecast,
    noEffectGuidance: tacticalSolved
      ? { entries: noEffectGuidance.entries, note: null, warning: null }
      : noEffectGuidance,
    outcomeConfidence,
    warSurvival,
    tacticalPriority,
    patternRecognition,
    suggestion,
    riskNote,
    strategyPlan,
    planNote: strategyPlan.kind === "none" ? null : strategyPlan.message,
    confidence: suggestion.confidence,
    war: warActive
      ? {
          active: true,
          pileCount: Math.max(0, Number(snapshot.war?.pileCount ?? 0) || 0),
          commitmentTotals: {
            player: Math.max(0, Number(snapshot.war?.commitmentTotals?.player ?? 0) || 0),
            opponent: Math.max(0, Number(snapshot.war?.commitmentTotals?.opponent ?? 0) || 0)
          },
          availableCards: available
        }
      : null
  };
}
