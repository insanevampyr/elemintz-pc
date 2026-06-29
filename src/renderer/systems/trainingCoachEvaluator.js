import { BEATS_MAP, ELEMENTS, elementThatBeats } from "../../engine/index.js";

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
    return {
      element,
      defeats,
      beatenBy,
      tieExposure,
      score: defeats - beatenBy - tieExposure
    };
  });
}

function buildTacticalRead({
  opponentCounts,
  opponentFatigueElement,
  playerFatigueElement,
  coverage,
  recentOpponentMoves
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

  if (playerFatigueElement) {
    read.push(`${playerFatigueElement} unavailable from fatigue`);
  }

  if (opponentFatigueElement) {
    read.push(`Opponent ${opponentFatigueElement} unavailable from fatigue`);
  }

  const recent = Array.isArray(recentOpponentMoves)
    ? recentOpponentMoves.map(normalizeElement).filter(Boolean).slice(-3)
    : [];
  const repeatedRecent = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : null;
  if (repeatedRecent) {
    read.push(`${repeatedRecent} repeat pattern likely based on recent cards`);
  }

  const tieRisk = coverage.find((entry) => entry.tieExposure > 0);
  if (tieRisk) {
    read.push("Tie risk still available");
  }

  return read.length > 0 ? read : ["No strong read"];
}

function chooseSuggestion({ coverage, opponentTotalCards }) {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return {
      kind: "none",
      element: null,
      reason: "No legal move available.",
      confidence: "none"
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
  if (opponentTotalCards > 0 && best.score >= 2 && best.score - nextBest.score >= 2) {
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
    reason: "No strong read.",
    confidence: "none"
  };
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
  const coverage = buildCoverage(legalElements, opponentRemainingByElement);
  const suggestion = chooseSuggestion({ coverage, opponentTotalCards });
  const phase = snapshot.phase === "war" ? "war" : "normal";
  const available = {
    player: Math.max(0, Number(snapshot.availableCards?.player ?? 0) || 0),
    opponent: Math.max(0, Number(snapshot.availableCards?.opponent ?? opponentTotalCards) || 0)
  };
  const warActive = phase === "war";
  const tieExposureTotal = coverage.reduce((total, entry) => total + entry.tieExposure, 0);
  const riskNote = buildRiskNote({ coverage, suggestion, warActive, available, tieExposureTotal });
  const strategyPlan = buildStrategyPlan({
    playerCounts: playerRemainingByElement,
    opponentCounts: opponentRemainingByElement,
    legalElements,
    playerFatigueElement,
    coverage,
    warActive,
    riskNote
  });

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
      playerFatigueElement,
      coverage,
      recentOpponentMoves: snapshot.recentOpponentMoves
    }),
    coverage: coverage.map(({ element, defeats, beatenBy, tieExposure }) => ({
      element,
      defeats,
      beatenBy,
      tieExposure
    })),
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
