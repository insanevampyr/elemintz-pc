import {
  EVENT_CHEST_OPEN_TYPES,
  EVENT_CHEST_RARITIES,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";
import { normalizeEventChestEligibility } from "./eventChestEligibility.js";
import { getEventChestRarityProbabilities } from "./eventChestOpening.js";
import {
  evaluateEventChestSchedule,
  normalizeEventChestActiveWindows
} from "./eventChestSchedule.js";
import { getCosmeticDefinition } from "./cosmeticSystem.js";

export const EVENT_CHEST_REVIEW_SCENARIOS = Object.freeze([
  "base",
  "epic_plus_due",
  "legendary_due"
]);

export const EVENT_CHEST_REVIEW_WARNING_SEVERITIES = Object.freeze([
  "critical",
  "high",
  "info"
]);

const METADATA_FIELDS = Object.freeze([
  "title",
  "subtitle",
  "description",
  "modalTitle",
  "collection",
  "artwork",
  "schedule",
  "openingMethods",
  "paidTokenCost",
  "freeOpenPolicy",
  "pity",
  "eligibility",
  "completion",
  "duplicateBehavior"
]);

const REQUIRED_DEFINITION_FIELDS = Object.freeze([
  "chestId",
  "title",
  "modalTitle",
  "chestType",
  "source",
  "dropKey",
  "collection",
  "releaseTag"
]);

const REQUIRED_DEFINED_FIELDS = Object.freeze([
  "lifecycle",
  "icons",
  "openTypes",
  "odds",
  "pity",
  "duplicateTokenRewards",
  "pool",
  "preferUnownedWithinRolledRarity",
  "hideTileWhenPoolComplete",
  "allowOpensAfterCompleteAsDuplicateConversion",
  "activeWindows",
  "definitionHistory",
  "preserveHistoryOnReactivation"
]);

const SEVERITY_RANK = Object.freeze({ critical: 0, high: 1, info: 2 });
const ODDS_TOLERANCE = 0.000001;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])])
  );
}

function valuesEqual(left, right) {
  return JSON.stringify(stableObject(left)) === JSON.stringify(stableObject(right));
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeArtwork(definition) {
  const artwork = isObject(definition?.artwork) ? definition.artwork : definition?.icons;
  if (!isObject(artwork)) {
    return null;
  }
  return {
    closed: text(artwork.closed),
    open: text(artwork.open),
    fallbackClosed: text(artwork.fallbackClosed),
    fallbackOpen: text(artwork.fallbackOpen)
  };
}

function normalizeOpeningMethods(definition) {
  const configured = new Set(Array.isArray(definition?.openTypes) ? definition.openTypes : []);
  return EVENT_CHEST_OPEN_TYPES.filter((method) => configured.has(method));
}

function normalizeFreeOpenPolicy(definition) {
  if (!isObject(definition?.freeOpenPolicy)) {
    return null;
  }
  return {
    cadence: text(definition.freeOpenPolicy.cadence),
    resetTimeZone: text(definition.freeOpenPolicy.resetTimeZone),
    resetHour: Number.isInteger(definition.freeOpenPolicy.resetHour)
      ? definition.freeOpenPolicy.resetHour
      : null
  };
}

function normalizePity(definition) {
  const pity = isObject(definition?.pity) ? definition.pity : {};
  return {
    epicPlusEnabled: pity.epicPlusEnabled !== false,
    legendaryEnabled: pity.legendaryEnabled !== false,
    epicPlusThreshold: Number.isInteger(pity.epicPlusThreshold)
      ? pity.epicPlusThreshold
      : null,
    legendaryThreshold: Number.isInteger(pity.legendaryThreshold)
      ? pity.legendaryThreshold
      : null,
    epicPlusTable: EVENT_CHEST_RARITIES.map((rarity) => ({
      rarity,
      weight: (Array.isArray(pity.epicPlusTable) ? pity.epicPlusTable : [])
        .filter((entry) => entry?.rarity === rarity)
        .reduce((sum, entry) => sum + (safeNumber(entry?.weight) ?? 0), 0)
    })).filter((entry) => entry.weight > 0)
  };
}

function normalizeCompletion(definition) {
  return {
    hideTileWhenPoolComplete: definition?.hideTileWhenPoolComplete === true
  };
}

function normalizeDuplicateBehavior(definition) {
  return {
    preferUnownedWithinRolledRarity: definition?.preferUnownedWithinRolledRarity === true,
    allowOpensAfterCompleteAsDuplicateConversion:
      definition?.allowOpensAfterCompleteAsDuplicateConversion === true,
    tokenRewards: Object.fromEntries(
      EVENT_CHEST_RARITIES.map((rarity) => [
        rarity,
        Number.isInteger(definition?.duplicateTokenRewards?.[rarity])
          ? definition.duplicateTokenRewards[rarity]
          : null
      ])
    )
  };
}

function normalizeSchedule(definition, nowMs) {
  const normalized = normalizeEventChestActiveWindows(definition?.activeWindows ?? []);
  const evaluated = evaluateEventChestSchedule(definition, { nowMs });
  return {
    windows: normalized.windows,
    state: evaluated.state,
    evaluatedAt: evaluated.evaluatedAt
  };
}

export function getEventChestCanonicalRewardKey(typeOrEntry, cosmeticId = null) {
  const type = text(isObject(typeOrEntry) ? typeOrEntry.type : typeOrEntry);
  const id = text(isObject(typeOrEntry) ? typeOrEntry.cosmeticId : cosmeticId);
  return type && id ? `${type}:${id}` : null;
}

function collectRewardRows(definition) {
  const rows = [];
  const seen = new Set();
  let ambiguous = false;
  let invalidReference = false;
  for (const rarity of EVENT_CHEST_RARITIES) {
    const entries = Array.isArray(definition?.pool?.[rarity]) ? definition.pool[rarity] : [];
    for (const entry of entries) {
      const rewardKey = getEventChestCanonicalRewardKey(entry);
      if (!rewardKey || seen.has(rewardKey)) {
        ambiguous = true;
      }
      if (rewardKey) {
        seen.add(rewardKey);
      }
      const cosmetic = rewardKey ? getCosmeticDefinition(entry.type, entry.cosmeticId) : null;
      const catalogRarity = text(cosmetic?.rarity)?.toLowerCase() ?? null;
      const referenceValid = Boolean(cosmetic && catalogRarity === rarity);
      invalidReference ||= !referenceValid;
      rows.push({
        rewardKey: rewardKey ?? `invalid:${rarity}:${rows.length}`,
        type: text(entry?.type),
        cosmeticId: text(entry?.cosmeticId),
        name: text(cosmetic?.name),
        rarity,
        element: text(cosmetic?.element),
        collection: text(cosmetic?.collection),
        image: text(cosmetic?.image),
        referenceValid
      });
    }
  }
  rows.sort((left, right) => left.rewardKey.localeCompare(right.rewardKey));
  return { rows, ambiguous, invalidReference };
}

function scenarioPityEffect(scenario) {
  if (scenario === "epic_plus_due") {
    return "epic_plus_guarantee";
  }
  if (scenario === "legendary_due") {
    return "legendary_guarantee";
  }
  return "none";
}

function buildInvalidScenario(scenario, rewards, invalidReason) {
  return {
    scenario,
    valid: false,
    invalidReason,
    rarityProbabilities: Object.fromEntries(EVENT_CHEST_RARITIES.map((rarity) => [rarity, 0])),
    rewards: rewards.map((reward) => ({
      rewardKey: reward.rewardKey,
      rarity: reward.rarity,
      baseWeight: 1,
      effectiveWeight: 0,
      finalPercentage: 0,
      exclusionReason: invalidReason,
      pityEffect: scenarioPityEffect(scenario)
    })),
    totalEffectiveWeight: 0
  };
}

export function projectEventChestOdds(definition) {
  const rewardCollection = collectRewardRows(definition);
  const rewardCounts = Object.fromEntries(
    EVENT_CHEST_RARITIES.map((rarity) => [
      rarity,
      rewardCollection.rows.filter((reward) => reward.rarity === rarity && reward.referenceValid).length
    ])
  );
  const scenarios = EVENT_CHEST_REVIEW_SCENARIOS.map((scenario) => {
    if (rewardCollection.ambiguous) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "ambiguous_reward_identity");
    }
    if (rewardCollection.invalidReference) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "invalid_reward_reference");
    }
    if (scenario === "epic_plus_due" && definition?.pity?.epicPlusEnabled === false) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "scenario_disabled");
    }
    if (scenario === "legendary_due" && definition?.pity?.legendaryEnabled === false) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "scenario_disabled");
    }

    const rarityProbabilities = getEventChestRarityProbabilities(definition, scenario);
    const probabilityValues = EVENT_CHEST_RARITIES.map((rarity) => rarityProbabilities[rarity]);
    const distributionValid = probabilityValues.every(
      (probability) => Number.isFinite(probability) && probability >= 0 && probability <= 1
    );
    const probabilityTotal = probabilityValues.reduce((sum, probability) => sum + probability, 0);
    const missingSelectableRarity = EVENT_CHEST_RARITIES.some(
      (rarity) => rarityProbabilities[rarity] > 0 && rewardCounts[rarity] === 0
    );
    if (!distributionValid || Math.abs(probabilityTotal - 1) > ODDS_TOLERANCE) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "invalid_rarity_distribution");
    }
    if (missingSelectableRarity) {
      return buildInvalidScenario(scenario, rewardCollection.rows, "no_selectable_reward");
    }

    const rewards = rewardCollection.rows.map((reward) => {
      const rarityProbability = rarityProbabilities[reward.rarity] ?? 0;
      const effectiveWeight = rarityProbability > 0
        ? rarityProbability / rewardCounts[reward.rarity]
        : 0;
      return {
        rewardKey: reward.rewardKey,
        rarity: reward.rarity,
        baseWeight: 1,
        effectiveWeight,
        finalPercentage: effectiveWeight * 100,
        exclusionReason: effectiveWeight > 0 ? null : "rarity_not_selected",
        pityEffect: scenarioPityEffect(scenario)
      };
    });
    return {
      scenario,
      valid: true,
      invalidReason: null,
      rarityProbabilities,
      rewards,
      totalEffectiveWeight: rewards.reduce((sum, reward) => sum + reward.effectiveWeight, 0)
    };
  });

  return {
    scenarios,
    valid: scenarios.every(
      (scenario) => scenario.valid || scenario.invalidReason === "scenario_disabled"
    ),
    note:
      "Runtime ownership preference may redistribute probability within a rolled rarity toward unowned rewards."
  };
}

function findPublishedTarget(draft, publishedDefinitions) {
  return (
    (Array.isArray(publishedDefinitions) ? publishedDefinitions : []).find(
      (definition) =>
        text(definition?.sourceDraftId) === draft.draftId &&
        text(definition?.sourceDraftRevisionId) === draft.draftRevisionId
    ) ?? null
  );
}

function derivePublishedLifecycle(definition, publishedDefinitions, lifecycle) {
  if (!definition) {
    return {
      definitionStatus: "unpublished",
      runtimeState: "unpublished",
      active: false,
      latest: false,
      archived: false
    };
  }
  const chestId = text(definition.chestId);
  const revisionId = text(definition.definitionRevisionId);
  const sameChest = (Array.isArray(publishedDefinitions) ? publishedDefinitions : [])
    .filter((entry) => text(entry?.chestId) === chestId)
    .sort((left, right) => {
      const timestampDelta = Date.parse(String(right?.publishedAt ?? "")) - Date.parse(String(left?.publishedAt ?? ""));
      return Number.isFinite(timestampDelta) && timestampDelta !== 0
        ? timestampDelta
        : String(right?.definitionRevisionId ?? "").localeCompare(String(left?.definitionRevisionId ?? ""));
    });
  const active =
    text(lifecycle?.active?.chestId) === chestId &&
    text(lifecycle?.active?.definitionRevisionId) === revisionId;
  const state = lifecycle?.revisionStates?.[`${chestId}:${revisionId}`] ?? null;
  const archived = state?.archived === true;
  const runtimeState = active ? "active" : archived ? "archived" : state?.state ?? "inactive";
  return {
    definitionStatus: text(definition?.lifecycle?.status) ?? "published",
    runtimeState,
    active,
    latest: sameChest[0]?.definitionRevisionId === revisionId,
    archived
  };
}

function buildLifecyclePreview(draft, publishedDefinitions, lifecycle) {
  const publishedTarget = findPublishedTarget(draft, publishedDefinitions);
  if (!publishedTarget) {
    return {
      definitionStatus: text(draft?.status) ?? "draft",
      runtimeState: "unpublished",
      active: false,
      latest: false,
      archived: false
    };
  }
  return {
    ...derivePublishedLifecycle(publishedTarget, publishedDefinitions, lifecycle),
    definitionStatus: text(draft?.status) ?? "draft"
  };
}

function buildBoundedDefinition(definition, nowMs) {
  const rewardCollection = collectRewardRows(definition);
  const odds = projectEventChestOdds(definition);
  const validation = validateEventChestDefinition(definition);
  return {
    display: {
      title: text(definition?.title),
      subtitle: text(definition?.subtitle),
      description: text(definition?.description),
      modalTitle: text(definition?.modalTitle),
      collection: text(definition?.collection),
      artwork: normalizeArtwork(definition)
    },
    schedule: normalizeSchedule(definition, nowMs),
    opening: {
      methods: normalizeOpeningMethods(definition),
      paidTokenCost: Number.isInteger(definition?.paidTokenCost) ? definition.paidTokenCost : null,
      freeOpenPolicy: normalizeFreeOpenPolicy(definition)
    },
    rewards: rewardCollection.rows.map(({ referenceValid: _referenceValid, ...reward }) => reward),
    odds,
    pity: normalizePity(definition),
    eligibility: normalizeEventChestEligibility(definition?.eligibility),
    completion: normalizeCompletion(definition),
    duplicates: normalizeDuplicateBehavior(definition),
    validation: {
      ok: validation.ok,
      issueCount: Array.isArray(validation.errors) ? validation.errors.length : 0
    }
  };
}

function comparisonMetadata(definition, nowMs) {
  const bounded = buildBoundedDefinition(definition, nowMs);
  return {
    title: bounded.display.title,
    subtitle: bounded.display.subtitle,
    description: bounded.display.description,
    modalTitle: bounded.display.modalTitle,
    collection: bounded.display.collection,
    artwork: bounded.display.artwork,
    schedule: bounded.schedule.windows,
    openingMethods: bounded.opening.methods,
    paidTokenCost: bounded.opening.paidTokenCost,
    freeOpenPolicy: bounded.opening.freeOpenPolicy,
    pity: bounded.pity,
    eligibility: bounded.eligibility,
    completion: bounded.completion,
    duplicateBehavior: bounded.duplicates
  };
}

function rewardComparisonRows(definition) {
  const bounded = buildBoundedDefinition(definition, 0);
  const percentagesByKey = new Map();
  for (const scenario of bounded.odds.scenarios) {
    for (const reward of scenario.rewards) {
      const current = percentagesByKey.get(reward.rewardKey) ?? {};
      current[scenario.scenario] = scenario.valid ? reward.finalPercentage : null;
      percentagesByKey.set(reward.rewardKey, current);
    }
  }
  return new Map(
    bounded.rewards.map((reward) => [
      reward.rewardKey,
      {
        rarity: reward.rarity,
        type: reward.type,
        cosmeticId: reward.cosmeticId,
        name: reward.name,
        element: reward.element,
        collection: reward.collection,
        image: reward.image,
        percentages: percentagesByKey.get(reward.rewardKey) ?? {}
      }
    ])
  );
}

function classifyFieldState(field, before, after) {
  if (valuesEqual(before, after)) {
    return "unchanged";
  }
  if (field === "paidTokenCost" && Number.isFinite(before) && Number.isFinite(after)) {
    return after > before ? "increased" : "decreased";
  }
  return "changed";
}

function classifyRewardState(before, after) {
  if (!before) {
    return "added";
  }
  if (!after) {
    return "removed";
  }
  const beforeMetadata = { ...before, percentages: undefined };
  const afterMetadata = { ...after, percentages: undefined };
  if (!valuesEqual(beforeMetadata, afterMetadata)) {
    return "changed";
  }
  const deltas = [];
  for (const scenario of EVENT_CHEST_REVIEW_SCENARIOS) {
    const beforeValue = before.percentages?.[scenario];
    const afterValue = after.percentages?.[scenario];
    if (beforeValue === afterValue) {
      continue;
    }
    if (Number.isFinite(beforeValue) && Number.isFinite(afterValue)) {
      deltas.push(afterValue - beforeValue);
      continue;
    }
    return "changed";
  }
  if (deltas.length === 0) {
    return "unchanged";
  }
  if (deltas.every((delta) => delta > 0)) {
    return "increased";
  }
  if (deltas.every((delta) => delta < 0)) {
    return "decreased";
  }
  return "changed";
}

export function compareEventChestDefinitions({
  draft,
  publishedDefinition,
  publishedDefinitions = [],
  lifecycle = null,
  nowMs = Date.now()
} = {}) {
  if (!publishedDefinition) {
    return null;
  }
  const beforeMetadata = comparisonMetadata(publishedDefinition, nowMs);
  const afterMetadata = comparisonMetadata(draft?.definition, nowMs);
  const fields = METADATA_FIELDS.map((field) => ({
    field,
    state: classifyFieldState(field, beforeMetadata[field], afterMetadata[field]),
    before: clone(beforeMetadata[field]),
    after: clone(afterMetadata[field])
  }));
  const beforeRewards = rewardComparisonRows(publishedDefinition);
  const afterRewards = rewardComparisonRows(draft?.definition);
  const rewardKeys = [...new Set([...beforeRewards.keys(), ...afterRewards.keys()])].sort();
  const rewards = rewardKeys.map((rewardKey) => {
    const before = beforeRewards.get(rewardKey) ?? null;
    const after = afterRewards.get(rewardKey) ?? null;
    return {
      rewardKey,
      state: classifyRewardState(before, after),
      before: clone(before),
      after: clone(after)
    };
  });
  const fieldCounts = Object.fromEntries(
    ["unchanged", "increased", "decreased", "changed"].map((state) => [
      state,
      fields.filter((entry) => entry.state === state).length
    ])
  );
  const rewardCounts = Object.fromEntries(
    ["unchanged", "added", "removed", "increased", "decreased", "changed"].map((state) => [
      state,
      rewards.filter((entry) => entry.state === state).length
    ])
  );
  return {
    draftIdentity: {
      draftId: draft?.draftId ?? null,
      draftRevisionId: draft?.draftRevisionId ?? null,
      chestId: draft?.chestId ?? null
    },
    publishedIdentity: {
      chestId: text(publishedDefinition?.chestId),
      definitionRevisionId: text(publishedDefinition?.definitionRevisionId),
      archived: derivePublishedLifecycle(
        publishedDefinition,
        publishedDefinitions,
        lifecycle
      ).archived
    },
    status:
      fields.every((entry) => entry.state === "unchanged") &&
      rewards.every((entry) => entry.state === "unchanged")
        ? "unchanged"
        : "changed",
    fields,
    rewards,
    summary: { fields: fieldCounts, rewards: rewardCounts }
  };
}

function warning(code, severity, message, affected) {
  return { code, severity, message, affected };
}

function hasValidationError(validation, pattern) {
  return (validation?.errors ?? []).some((entry) => pattern.test(String(entry)));
}

function compareField(comparison, field) {
  return comparison?.fields?.find((entry) => entry.field === field) ?? null;
}

export function evaluateEventChestReviewWarnings({
  draft,
  preview,
  comparison = null,
  publicationIdentityConflict = false
} = {}) {
  const definition = draft?.definition ?? {};
  const validation = validateEventChestDefinition(definition);
  const rewardCollection = collectRewardRows(definition);
  const items = [];
  if (rewardCollection.rows.length === 0) {
    items.push(warning(
      "EVENT_CHEST_EMPTY_REWARD_POOL",
      "critical",
      "The Event Chest has no configured rewards.",
      "rewards"
    ));
  }
  if (
    preview?.odds?.scenarios?.some(
      (scenario) => scenario.invalidReason === "no_selectable_reward"
    )
  ) {
    items.push(warning(
      "EVENT_CHEST_NO_SELECTABLE_REWARD",
      "critical",
      "No configured odds scenario can select a reward.",
      "rewards"
    ));
  }
  if (rewardCollection.ambiguous) {
    items.push(warning(
      "EVENT_CHEST_AMBIGUOUS_REWARD_IDENTITY",
      "critical",
      "Two or more rewards share an invalid or duplicate canonical identity.",
      "rewards"
    ));
  }
  if (rewardCollection.invalidReference) {
    items.push(warning(
      "EVENT_CHEST_INVALID_REWARD_REFERENCE",
      "critical",
      "One or more rewards do not resolve to the configured catalog rarity.",
      "rewards"
    ));
  }
  if (
    !Array.isArray(definition?.openTypes) ||
    definition.openTypes.length === 0 ||
    hasValidationError(validation, /openType|freeOpenPolicy|paidTokenCost/)
  ) {
    items.push(warning(
      "EVENT_CHEST_IMPOSSIBLE_OPEN_CONFIGURATION",
      "critical",
      "The configured opening methods cannot produce a valid opening.",
      "opening"
    ));
  }
  if (hasValidationError(validation, /^pity\.|pity must|Legendary pity|Epic\+ pity/)) {
    items.push(warning(
      "EVENT_CHEST_INVALID_PITY_CONFIGURATION",
      "critical",
      "The pity configuration is invalid.",
      "pity"
    ));
  }
  if (publicationIdentityConflict) {
    items.push(warning(
      "EVENT_CHEST_PUBLICATION_IDENTITY_CONFLICT",
      "critical",
      "The draft publication identity conflicts with an existing published revision.",
      "publicationIdentity"
    ));
  }
  const missingFields = new Set(
    REQUIRED_DEFINITION_FIELDS.filter((field) => !text(definition?.[field]))
  );
  for (const field of REQUIRED_DEFINED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(definition, field)) {
      missingFields.add(field);
    }
  }
  if (isObject(definition?.lifecycle)) {
    if (!text(definition.lifecycle.status)) {
      missingFields.add("lifecycle.status");
    }
    if (!Object.prototype.hasOwnProperty.call(definition.lifecycle, "defaultPreset")) {
      missingFields.add("lifecycle.defaultPreset");
    }
  }
  if (isObject(definition?.icons)) {
    for (const field of ["closed", "open", "fallbackClosed", "fallbackOpen"]) {
      if (!text(definition.icons[field])) {
        missingFields.add(`icons.${field}`);
      }
    }
  }
  if (Array.isArray(definition?.openTypes) && definition.openTypes.includes("free")) {
    if (!Object.prototype.hasOwnProperty.call(definition, "freeOpenPolicy")) {
      missingFields.add("freeOpenPolicy");
    }
  }
  if (Array.isArray(definition?.openTypes) && definition.openTypes.includes("paid")) {
    if (!Object.prototype.hasOwnProperty.call(definition, "paidTokenCost")) {
      missingFields.add("paidTokenCost");
    }
  }
  for (const field of [...missingFields].sort()) {
    items.push(warning(
      "EVENT_CHEST_REQUIRED_FIELD_MISSING",
      "critical",
      `Required Event Chest field '${field}' is missing.`,
      field
    ));
  }
  if (preview?.schedule?.state === "ended") {
    items.push(warning(
      "EVENT_CHEST_SCHEDULE_EXPIRED",
      "high",
      "All configured Event Chest schedule windows have ended.",
      "schedule"
    ));
  }
  if (preview?.schedule?.state === "invalid") {
    items.push(warning(
      "EVENT_CHEST_SCHEDULE_INVALID_RANGE",
      "high",
      "The Event Chest schedule contains an invalid range.",
      "schedule"
    ));
  }
  for (const reward of comparison?.rewards ?? []) {
    if (reward.state === "removed") {
      items.push(warning(
        "EVENT_CHEST_REWARD_REMOVED",
        "high",
        `Reward '${reward.rewardKey}' is removed from this revision.`,
        reward.rewardKey
      ));
    }
  }
  for (const reward of preview?.rewards ?? []) {
    const probabilities = (preview?.odds?.scenarios ?? [])
      .filter((scenario) => scenario.valid)
      .map((scenario) =>
        scenario.rewards.find((entry) => entry.rewardKey === reward.rewardKey)?.finalPercentage ?? 0
      );
    if (probabilities.length > 0 && probabilities.every((value) => value === 0)) {
      items.push(warning(
        "EVENT_CHEST_REWARD_UNOBTAINABLE",
        "high",
        `Reward '${reward.rewardKey}' has no probability in any configured scenario.`,
        reward.rewardKey
      ));
    }
  }
  const methodsChange = compareField(comparison, "openingMethods");
  if (
    methodsChange &&
    Array.isArray(methodsChange.before) &&
    methodsChange.before.includes("free") &&
    !methodsChange.after?.includes("free")
  ) {
    items.push(warning(
      "EVENT_CHEST_FREE_OPEN_REMOVED",
      "high",
      "Free opening is removed from this revision.",
      "openingMethods"
    ));
  }
  const tokenCostChange = compareField(comparison, "paidTokenCost");
  if (tokenCostChange && tokenCostChange.state !== "unchanged") {
    items.push(warning(
      "EVENT_CHEST_TOKEN_COST_CHANGED",
      "high",
      "The paid Token cost changes in this revision.",
      "paidTokenCost"
    ));
  }
  const pityChange = compareField(comparison, "pity");
  if (pityChange) {
    for (const kind of ["epicPlus", "legendary"]) {
      if (pityChange.before?.[`${kind}Enabled`] === true && pityChange.after?.[`${kind}Enabled`] === false) {
        items.push(warning(
          "EVENT_CHEST_PITY_DISABLED",
          "high",
          `${kind === "epicPlus" ? "Epic+" : "Legendary"} pity is disabled in this revision.`,
          `pity.${kind}Enabled`
        ));
      }
      const beforeThreshold = pityChange.before?.[`${kind}Threshold`];
      const afterThreshold = pityChange.after?.[`${kind}Threshold`];
      if (Number.isInteger(beforeThreshold) && Number.isInteger(afterThreshold) && afterThreshold > beforeThreshold) {
        items.push(warning(
          "EVENT_CHEST_PITY_THRESHOLD_INCREASED",
          "high",
          `${kind === "epicPlus" ? "Epic+" : "Legendary"} pity requires more misses in this revision.`,
          `pity.${kind}Threshold`
        ));
      }
    }
  }
  for (const reward of comparison?.rewards ?? []) {
    const percentageDecreased = EVENT_CHEST_REVIEW_SCENARIOS.some((scenario) => {
      const before = reward.before?.percentages?.[scenario];
      const after = reward.after?.percentages?.[scenario];
      return Number.isFinite(before) && Number.isFinite(after) && after < before;
    });
    if (percentageDecreased) {
      items.push(warning(
        "EVENT_CHEST_REWARD_PERCENTAGE_DECREASED",
        "info",
        `Reward '${reward.rewardKey}' has a lower percentage in at least one scenario.`,
        reward.rewardKey
      ));
    }
  }
  if (comparison?.fields?.some((field) => field.state !== "unchanged")) {
    items.push(warning(
      "EVENT_CHEST_METADATA_CHANGED",
      "info",
      "One or more recognized Event Chest metadata fields changed.",
      "metadata"
    ));
  }
  if (!comparison) {
    items.push(warning(
      "EVENT_CHEST_NO_COMPARISON_BASE",
      "info",
      "No exact published revision was selected for comparison.",
      "comparison"
    ));
  }

  items.sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    left.code.localeCompare(right.code) ||
    String(left.affected).localeCompare(String(right.affected))
  );
  return {
    highestSeverity: items[0]?.severity ?? null,
    items
  };
}

export function buildEventChestDraftReview({
  draft,
  publishedDefinition = null,
  publishedDefinitions = [],
  lifecycle = null,
  readAt = new Date().toISOString()
} = {}) {
  const nowMs = Date.parse(String(readAt ?? ""));
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const bounded = buildBoundedDefinition(draft?.definition, safeNowMs);
  const publicationIdentityConflict = (Array.isArray(publishedDefinitions) ? publishedDefinitions : []).some(
    (definition) =>
      text(definition?.chestId) === text(draft?.chestId) &&
      text(definition?.definitionRevisionId) === text(draft?.definition?.definitionRevisionId) &&
      !(
        text(definition?.sourceDraftId) === text(draft?.draftId) &&
        text(definition?.sourceDraftRevisionId) === text(draft?.draftRevisionId)
      )
  );
  const comparison = compareEventChestDefinitions({
    draft,
    publishedDefinition,
    publishedDefinitions,
    lifecycle,
    nowMs: safeNowMs
  });
  const preview = {
    display: bounded.display,
    lifecycle: buildLifecyclePreview(draft, publishedDefinitions, lifecycle),
    schedule: bounded.schedule,
    opening: bounded.opening,
    rewards: bounded.rewards,
    odds: bounded.odds,
    pity: bounded.pity,
    eligibility: bounded.eligibility,
    completion: bounded.completion,
    duplicates: bounded.duplicates,
    validation: bounded.validation
  };
  return {
    readAt: new Date(safeNowMs).toISOString(),
    target: {
      kind: "draft",
      draftId: draft?.draftId ?? null,
      draftRevisionId: draft?.draftRevisionId ?? null,
      chestId: draft?.chestId ?? null
    },
    preview,
    comparison,
    warnings: evaluateEventChestReviewWarnings({
      draft,
      preview,
      comparison,
      publicationIdentityConflict
    })
  };
}
