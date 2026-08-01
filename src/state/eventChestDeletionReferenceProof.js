import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "./dailyElementChestSystem.js";
import {
  EVENT_CHEST_DRAFT_STATUSES,
  EVENT_CHEST_DRAFT_STORE_VERSION
} from "./eventChestDraftStore.js";
import { validateEventChestRegistryDocumentForAdmin } from "./eventChestRegistryStore.js";
import {
  EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
  EVENT_CHEST_LIFECYCLE_EVENT_TYPES,
  EVENT_CHEST_REVISION_LIFECYCLE_STATES,
  buildEventChestRevisionLifecycleKey
} from "./eventChestActivationStore.js";
import { normalizeEventChestEntitlement } from "./eventChestEntitlements.js";
import {
  normalizeEventChestDirectOpeningSettlement,
  normalizeEventChestDirectRequestId
} from "./eventChestDirectOpenings.js";
import { normalizeEventChestRewardSettlement } from "./eventChestOpening.js";

export const EVENT_CHEST_DRAFT_REFERENCE_PROOF_SCHEMA_VERSION = 1;

export const EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  DRAFT_STORE_UNAVAILABLE: "draft_store_unavailable",
  DRAFT_STORE_MALFORMED: "draft_store_malformed",
  DRAFT_NOT_FOUND: "draft_not_found",
  DRAFT_REVISION_MISMATCH: "draft_revision_mismatch",
  DRAFT_NOT_UNPUBLISHED: "draft_not_unpublished",
  DRAFT_REFERENCED_BY_DRAFT: "draft_referenced_by_draft",
  DRAFT_SHARED_CHEST: "draft_shared_chest",
  REGISTRY_UNAVAILABLE: "registry_unavailable",
  REGISTRY_MALFORMED: "registry_malformed",
  REGISTRY_SOURCE_REFERENCE: "registry_source_reference",
  REGISTRY_SHARED_CHEST: "registry_shared_chest",
  LIFECYCLE_UNAVAILABLE: "lifecycle_unavailable",
  LIFECYCLE_MALFORMED: "lifecycle_malformed",
  LIFECYCLE_REFERENCE: "lifecycle_reference",
  PROFILES_UNAVAILABLE: "profiles_unavailable",
  PROFILES_MALFORMED: "profiles_malformed",
  PROFILE_REFERENCE: "profile_reference",
  DAILY_CHEST_RESERVED: "daily_chest_reserved"
});

const PROOF_STATUSES = Object.freeze({
  ELIGIBLE: "eligible",
  BLOCKED: "blocked",
  UNAVAILABLE: "unavailable"
});

const REFERENCE_CATEGORIES = Object.freeze({
  DRAFT_LINEAGE: "draft_lineage",
  DRAFT_SHARED_CHEST: "draft_shared_chest",
  REGISTRY_SOURCE: "registry_source",
  REGISTRY_CHEST: "registry_chest",
  LIFECYCLE: "lifecycle",
  PROFILE_PROGRESS: "profile_progress",
  PROFILE_PITY: "profile_pity",
  PROFILE_ENTITLEMENT: "profile_entitlement",
  PROFILE_ENTITLEMENT_SETTLEMENT: "profile_entitlement_settlement",
  PROFILE_DIRECT_SETTLEMENT: "profile_direct_settlement",
  DAILY_CHEST: "daily_chest"
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    return null;
  }
  return value;
}

function optionalTextIsValid(value) {
  return value == null || requiredText(value) !== null;
}

function validIso(value, { optional = false } = {}) {
  if (value == null || value === "") {
    return optional;
  }
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function addUnique(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function buildProofResult({
  requestedDraftId,
  expectedDraftRevisionId,
  candidate = null,
  reasonCodes = [],
  referenceCategories = [],
  unavailable = false
}) {
  const reasons = [...new Set(reasonCodes)].sort();
  const categories = [...new Set(referenceCategories)].sort();
  const status = unavailable
    ? PROOF_STATUSES.UNAVAILABLE
    : reasons.length > 0
      ? PROOF_STATUSES.BLOCKED
      : PROOF_STATUSES.ELIGIBLE;
  return {
    schemaVersion: EVENT_CHEST_DRAFT_REFERENCE_PROOF_SCHEMA_VERSION,
    status,
    eligible: status === PROOF_STATUSES.ELIGIBLE,
    draft: candidate
      ? {
          draftId: candidate.draftId,
          draftRevisionId: candidate.draftRevisionId,
          chestId: candidate.chestId
        }
      : {
          draftId: requestedDraftId ?? null,
          draftRevisionId: expectedDraftRevisionId ?? null,
          chestId: null
        },
    reasonCodes: reasons,
    referenceCategories: categories
  };
}

function validateOptionalIdentityPair(record, leftField, rightField) {
  const left = record[leftField];
  const right = record[rightField];
  const hasLeft = left != null;
  const hasRight = right != null;
  return hasLeft === hasRight && optionalTextIsValid(left) && optionalTextIsValid(right);
}

function inspectDraftDocument(document, requestedDraftId, expectedDraftRevisionId) {
  const reasonCodes = [];
  const referenceCategories = [];
  if (
    !isPlainObject(document) ||
    document.schemaVersion !== EVENT_CHEST_DRAFT_STORE_VERSION ||
    !Array.isArray(document.drafts)
  ) {
    return { malformed: true, reasonCodes, referenceCategories, candidate: null };
  }

  const drafts = [];
  const seenDraftIds = new Set();
  const seenDraftRevisionIds = new Set();
  for (const rawDraft of document.drafts) {
    if (!isPlainObject(rawDraft) || !isPlainObject(rawDraft.definition)) {
      return { malformed: true, reasonCodes, referenceCategories, candidate: null };
    }
    const draftId = requiredText(rawDraft.draftId);
    const draftRevisionId = requiredText(rawDraft.draftRevisionId);
    const chestId = requiredText(rawDraft.chestId);
    const definitionChestId = requiredText(rawDraft.definition.chestId);
    if (
      !draftId ||
      !draftRevisionId ||
      !chestId ||
      !definitionChestId ||
      chestId !== definitionChestId ||
      seenDraftIds.has(draftId) ||
      seenDraftRevisionIds.has(draftRevisionId) ||
      !EVENT_CHEST_DRAFT_STATUSES.includes(rawDraft.status) ||
      !validIso(rawDraft.createdAt) ||
      !validIso(rawDraft.updatedAt) ||
      Date.parse(rawDraft.updatedAt) < Date.parse(rawDraft.createdAt) ||
      !validateOptionalIdentityPair(rawDraft, "copiedFromDraftId", "copiedFromDraftRevisionId") ||
      !validateOptionalIdentityPair(
        rawDraft,
        "copiedFromChestId",
        "copiedFromDefinitionRevisionId"
      )
    ) {
      return { malformed: true, reasonCodes, referenceCategories, candidate: null };
    }
    seenDraftIds.add(draftId);
    seenDraftRevisionIds.add(draftRevisionId);
    drafts.push({
      draftId,
      draftRevisionId,
      chestId,
      status: rawDraft.status,
      copiedFromDraftId: rawDraft.copiedFromDraftId ?? null,
      copiedFromDraftRevisionId: rawDraft.copiedFromDraftRevisionId ?? null
    });
  }

  const candidate = drafts.find((draft) => draft.draftId === requestedDraftId) ?? null;
  if (!candidate) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_NOT_FOUND);
    return { malformed: false, reasonCodes, referenceCategories, candidate: null };
  }
  if (candidate.draftRevisionId !== expectedDraftRevisionId) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REVISION_MISMATCH);
  }
  if (!["draft", "validation_failed", "ready"].includes(candidate.status)) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_NOT_UNPUBLISHED);
  }

  if (
    drafts.some(
      (draft) =>
        draft.draftId !== candidate.draftId &&
        (draft.copiedFromDraftId === candidate.draftId ||
          draft.copiedFromDraftRevisionId === candidate.draftRevisionId)
    )
  ) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REFERENCED_BY_DRAFT);
    addUnique(referenceCategories, REFERENCE_CATEGORIES.DRAFT_LINEAGE);
  }
  if (
    drafts.some(
      (draft) => draft.draftId !== candidate.draftId && draft.chestId === candidate.chestId
    )
  ) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_SHARED_CHEST);
    addUnique(referenceCategories, REFERENCE_CATEGORIES.DRAFT_SHARED_CHEST);
  }
  return { malformed: false, reasonCodes, referenceCategories, candidate };
}

function inspectRegistryDocument(document, candidate) {
  const reasonCodes = [];
  const referenceCategories = [];
  if (document == null) {
    return { malformed: false, reasonCodes, referenceCategories };
  }
  const validation = validateEventChestRegistryDocumentForAdmin(document);
  if (!validation.ok || !validation.registry) {
    return { malformed: true, reasonCodes, referenceCategories };
  }

  for (const definition of validation.registry.definitions) {
    const chestId = requiredText(definition?.chestId);
    const definitionRevisionId = requiredText(definition?.definitionRevisionId);
    const publishedAt = definition?.publishedAt;
    const isStaticDailyDefault =
      chestId === DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID &&
      !definitionRevisionId &&
      !publishedAt;
    if (
      !chestId ||
      (!isStaticDailyDefault && (!definitionRevisionId || !validIso(publishedAt))) ||
      !validateOptionalIdentityPair(definition, "sourceDraftId", "sourceDraftRevisionId")
    ) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    if (
      definition.sourceDraftId === candidate.draftId ||
      definition.sourceDraftRevisionId === candidate.draftRevisionId
    ) {
      addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SOURCE_REFERENCE);
      addUnique(referenceCategories, REFERENCE_CATEGORIES.REGISTRY_SOURCE);
    }
    if (chestId === candidate.chestId) {
      addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SHARED_CHEST);
      addUnique(referenceCategories, REFERENCE_CATEGORIES.REGISTRY_CHEST);
    }
  }
  return { malformed: false, reasonCodes, referenceCategories };
}

function collectLifecycleReference(references, chestId, definitionRevisionId) {
  const safeChestId = requiredText(chestId);
  const safeRevisionId = requiredText(definitionRevisionId);
  if (!safeChestId || !safeRevisionId) {
    return false;
  }
  references.push({ chestId: safeChestId, definitionRevisionId: safeRevisionId });
  return true;
}

function inspectLifecycleDocument(document, candidate) {
  const reasonCodes = [];
  const referenceCategories = [];
  if (document == null) {
    return { malformed: false, reasonCodes, referenceCategories };
  }
  if (!isPlainObject(document) || ![1, 2, EVENT_CHEST_ACTIVATION_SCHEMA_VERSION].includes(document.schemaVersion)) {
    return { malformed: true, reasonCodes, referenceCategories };
  }

  const references = [];
  if (document.schemaVersion === 1) {
    if (!["active", "inactive"].includes(document.status)) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    const hasChest = document.chestId != null;
    const hasRevision = document.definitionRevisionId != null;
    if (hasChest !== hasRevision) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    if (hasChest && !collectLifecycleReference(references, document.chestId, document.definitionRevisionId)) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    if (
      document.status === "active" &&
      (!requiredText(document.activationRevisionId) || !validIso(document.activatedAt))
    ) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
  } else {
    if (document.active != null) {
      if (
        !isPlainObject(document.active) ||
        !requiredText(document.active.activationRevisionId) ||
        !validIso(document.active.activatedAt) ||
        !collectLifecycleReference(
          references,
          document.active.chestId,
          document.active.definitionRevisionId
        )
      ) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
    }
    if (!isPlainObject(document.revisionStates)) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    for (const [key, state] of Object.entries(document.revisionStates)) {
      if (
        !isPlainObject(state) ||
        !EVENT_CHEST_REVISION_LIFECYCLE_STATES.includes(state.state) ||
        !collectLifecycleReference(references, state.chestId, state.definitionRevisionId) ||
        key !== buildEventChestRevisionLifecycleKey(state.chestId, state.definitionRevisionId) ||
        (state.state === "ended" && !validIso(state.endedAt))
      ) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
    }
    if (document.schemaVersion === 2 && document.history != null) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    if (document.schemaVersion === EVENT_CHEST_ACTIVATION_SCHEMA_VERSION) {
      if (!Array.isArray(document.history)) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      const seenEventIds = new Set();
      for (const event of document.history) {
        const eventId = requiredText(event?.eventId);
        if (
          !isPlainObject(event) ||
          !eventId ||
          seenEventIds.has(eventId) ||
          !EVENT_CHEST_LIFECYCLE_EVENT_TYPES.includes(event.eventType) ||
          !validIso(event.occurredAt) ||
          !collectLifecycleReference(references, event.chestId, event.definitionRevisionId)
        ) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        seenEventIds.add(eventId);
        if (event.priorActiveRevision != null) {
          if (
            !isPlainObject(event.priorActiveRevision) ||
            !collectLifecycleReference(
              references,
              event.priorActiveRevision.chestId,
              event.priorActiveRevision.definitionRevisionId
            )
          ) {
            return { malformed: true, reasonCodes, referenceCategories };
          }
        }
      }
    }
  }

  if (references.some((reference) => reference.chestId === candidate.chestId)) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_REFERENCE);
    addUnique(referenceCategories, REFERENCE_CATEGORIES.LIFECYCLE);
  }
  return { malformed: false, reasonCodes, referenceCategories };
}

function validateProfileProgress(progress, keyChestId) {
  if (!isPlainObject(progress)) {
    return { valid: false, revisionIds: [] };
  }
  const chestId = requiredText(progress.chestId);
  if (!chestId || chestId !== keyChestId || (progress.schemaVersion != null && progress.schemaVersion !== 1)) {
    return { valid: false, revisionIds: [] };
  }
  for (const field of ["totalOpens", "paidOpens", "freeOpens"]) {
    if (progress[field] != null && !validNonNegativeInteger(progress[field])) {
      return { valid: false, revisionIds: [] };
    }
  }
  if (progress.lastOpenType != null && !["free", "paid"].includes(progress.lastOpenType)) {
    return { valid: false, revisionIds: [] };
  }
  if (progress.pity != null) {
    if (
      !isPlainObject(progress.pity) ||
      !validNonNegativeInteger(progress.pity.opensSinceEpicPlus) ||
      !validNonNegativeInteger(progress.pity.opensSinceLegendary)
    ) {
      return { valid: false, revisionIds: [] };
    }
  }
  for (const field of ["firstOpenedAt", "lastOpenedAt", "lastUpdatedAt", "lastFreeOpenDateKey"]) {
    if (progress[field] != null && !validIso(progress[field], { optional: true })) {
      return { valid: false, revisionIds: [] };
    }
  }
  const participation = progress.participation;
  if (participation == null) {
    return { valid: true, revisionIds: [] };
  }
  if (!isPlainObject(participation)) {
    return { valid: false, revisionIds: [] };
  }
  for (const field of ["firstDefinitionSeenAt", "lastDefinitionSeenAt"]) {
    if (participation[field] != null && !validIso(participation[field], { optional: true })) {
      return { valid: false, revisionIds: [] };
    }
  }
  if (
    participation.definitionRevisionIdsSeen != null &&
    !Array.isArray(participation.definitionRevisionIdsSeen)
  ) {
    return { valid: false, revisionIds: [] };
  }
  const revisionIds = participation.definitionRevisionIdsSeen ?? [];
  if (revisionIds.some((value) => !requiredText(value)) || new Set(revisionIds).size !== revisionIds.length) {
    return { valid: false, revisionIds: [] };
  }
  return { valid: true, revisionIds };
}

function inspectProfileDocument(document, candidate) {
  const reasonCodes = [];
  const referenceCategories = [];
  if (document == null) {
    return { malformed: false, reasonCodes, referenceCategories };
  }
  if (!Array.isArray(document)) {
    return { malformed: true, reasonCodes, referenceCategories };
  }
  const seenProfiles = new Set();
  for (const profile of document) {
    const username = requiredText(profile?.username);
    const normalizedUsername = username?.toLowerCase() ?? null;
    if (!isPlainObject(profile) || !username || seenProfiles.has(normalizedUsername)) {
      return { malformed: true, reasonCodes, referenceCategories };
    }
    seenProfiles.add(normalizedUsername);

    if (profile.eventChests != null) {
      if (!isPlainObject(profile.eventChests)) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      for (const [rawChestId, progress] of Object.entries(profile.eventChests)) {
        const chestId = requiredText(rawChestId);
        const inspected = chestId ? validateProfileProgress(progress, chestId) : { valid: false };
        if (!inspected.valid) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        if (chestId === candidate.chestId) {
          addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE);
          addUnique(referenceCategories, REFERENCE_CATEGORIES.PROFILE_PROGRESS);
        }
      }
    }

    if (profile.eventChestPity != null) {
      const pity = profile.eventChestPity;
      if (pity?.schemaVersion !== 1 || !isPlainObject(pity.byChestId)) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      for (const [rawChestId, state] of Object.entries(pity.byChestId)) {
        const chestId = requiredText(rawChestId);
        if (
          !chestId ||
          !isPlainObject(state) ||
          !validNonNegativeInteger(state.epicPlusMisses) ||
          !validNonNegativeInteger(state.legendaryMisses) ||
          !validIso(state.updatedAt, { optional: true })
        ) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        if (chestId === candidate.chestId) {
          addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE);
          addUnique(referenceCategories, REFERENCE_CATEGORIES.PROFILE_PITY);
        }
      }
    }

    if (profile.eventChestEntitlements != null) {
      const entitlements = profile.eventChestEntitlements;
      if (entitlements?.schemaVersion !== 1 || !Array.isArray(entitlements.items)) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      const seenEntitlementIds = new Set();
      for (const item of entitlements.items) {
        const entitlementId = requiredText(item?.entitlementId);
        const chestId = requiredText(item?.chestId);
        const definitionRevisionId = requiredText(item?.definitionRevisionId);
        const normalized = normalizeEventChestEntitlement(item);
        if (
          !entitlementId ||
          !chestId ||
          !definitionRevisionId ||
          !normalized ||
          seenEntitlementIds.has(entitlementId)
        ) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        seenEntitlementIds.add(entitlementId);
        if (item.status === "opened") {
          const settlement = normalizeEventChestRewardSettlement(item.rewardSettlement);
          if (
            !settlement ||
            settlement.entitlementId !== entitlementId ||
            settlement.chestId !== chestId ||
            settlement.definitionRevisionId !== definitionRevisionId
          ) {
            return { malformed: true, reasonCodes, referenceCategories };
          }
        } else if (item.rewardSettlement != null) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        if (chestId === candidate.chestId) {
          addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE);
          addUnique(referenceCategories, REFERENCE_CATEGORIES.PROFILE_ENTITLEMENT);
          if (item.rewardSettlement != null) {
            addUnique(
              referenceCategories,
              REFERENCE_CATEGORIES.PROFILE_ENTITLEMENT_SETTLEMENT
            );
          }
        }
      }
    }

    if (profile.eventChestDirectOpenings != null) {
      const direct = profile.eventChestDirectOpenings;
      if (
        direct?.schemaVersion !== 1 ||
        !Array.isArray(direct.settlements) ||
        (direct.invalidRequestIds != null && !Array.isArray(direct.invalidRequestIds))
      ) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      const invalidRequestIds = direct.invalidRequestIds ?? [];
      if (
        invalidRequestIds.some(
          (requestId) => normalizeEventChestDirectRequestId(requestId) !== requestId
        ) ||
        new Set(invalidRequestIds).size !== invalidRequestIds.length
      ) {
        return { malformed: true, reasonCodes, referenceCategories };
      }
      const seenRequestIds = new Set();
      for (const settlement of direct.settlements) {
        const requestId = requiredText(settlement?.requestId);
        const chestId = requiredText(settlement?.chestId);
        const definitionRevisionId = requiredText(settlement?.definitionRevisionId);
        if (
          !requestId ||
          !chestId ||
          !definitionRevisionId ||
          !normalizeEventChestDirectOpeningSettlement(settlement) ||
          seenRequestIds.has(requestId)
        ) {
          return { malformed: true, reasonCodes, referenceCategories };
        }
        seenRequestIds.add(requestId);
        if (chestId === candidate.chestId) {
          addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE);
          addUnique(referenceCategories, REFERENCE_CATEGORIES.PROFILE_DIRECT_SETTLEMENT);
        }
      }
    }
  }
  return { malformed: false, reasonCodes, referenceCategories };
}

export function buildEventChestDraftDeletionReferenceProof({
  requestedDraftId,
  expectedDraftRevisionId,
  draftDocument,
  registryDocument = null,
  lifecycleDocument = null,
  profilesDocument = null,
  unavailableReasonCodes = []
} = {}) {
  const safeDraftId = requiredText(requestedDraftId);
  const safeExpectedRevisionId = requiredText(expectedDraftRevisionId);
  if (!safeDraftId || !safeExpectedRevisionId) {
    return buildProofResult({
      requestedDraftId: safeDraftId,
      expectedDraftRevisionId: safeExpectedRevisionId,
      reasonCodes: [EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.INVALID_REQUEST]
    });
  }
  if (unavailableReasonCodes.length > 0) {
    return buildProofResult({
      requestedDraftId: safeDraftId,
      expectedDraftRevisionId: safeExpectedRevisionId,
      reasonCodes: unavailableReasonCodes,
      unavailable: true
    });
  }

  const draftInspection = inspectDraftDocument(
    draftDocument,
    safeDraftId,
    safeExpectedRevisionId
  );
  if (draftInspection.malformed) {
    return buildProofResult({
      requestedDraftId: safeDraftId,
      expectedDraftRevisionId: safeExpectedRevisionId,
      reasonCodes: [EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_STORE_MALFORMED],
      unavailable: true
    });
  }
  if (!draftInspection.candidate) {
    return buildProofResult({
      requestedDraftId: safeDraftId,
      expectedDraftRevisionId: safeExpectedRevisionId,
      reasonCodes: draftInspection.reasonCodes,
      referenceCategories: draftInspection.referenceCategories
    });
  }

  const candidate = draftInspection.candidate;
  const registryInspection = inspectRegistryDocument(registryDocument, candidate);
  const lifecycleInspection = inspectLifecycleDocument(lifecycleDocument, candidate);
  const profileInspection = inspectProfileDocument(profilesDocument, candidate);
  const malformedReasons = [];
  if (registryInspection.malformed) {
    malformedReasons.push(EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_MALFORMED);
  }
  if (lifecycleInspection.malformed) {
    malformedReasons.push(EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_MALFORMED);
  }
  if (profileInspection.malformed) {
    malformedReasons.push(EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILES_MALFORMED);
  }
  if (malformedReasons.length > 0) {
    return buildProofResult({
      requestedDraftId: safeDraftId,
      expectedDraftRevisionId: safeExpectedRevisionId,
      candidate,
      reasonCodes: malformedReasons,
      unavailable: true
    });
  }

  const reasonCodes = [
    ...draftInspection.reasonCodes,
    ...registryInspection.reasonCodes,
    ...lifecycleInspection.reasonCodes,
    ...profileInspection.reasonCodes
  ];
  const referenceCategories = [
    ...draftInspection.referenceCategories,
    ...registryInspection.referenceCategories,
    ...lifecycleInspection.referenceCategories,
    ...profileInspection.referenceCategories
  ];
  if (candidate.chestId === DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID) {
    addUnique(reasonCodes, EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DAILY_CHEST_RESERVED);
    addUnique(referenceCategories, REFERENCE_CATEGORIES.DAILY_CHEST);
  }
  return buildProofResult({
    requestedDraftId: safeDraftId,
    expectedDraftRevisionId: safeExpectedRevisionId,
    candidate,
    reasonCodes,
    referenceCategories
  });
}
