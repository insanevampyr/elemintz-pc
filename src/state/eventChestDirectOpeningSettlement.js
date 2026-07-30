import crypto from "node:crypto";

import {
  EVENT_CHEST_DIRECT_OPENING_SETTLEMENT_SCHEMA_VERSION,
  normalizeEventChestDirectOpeningSettlement,
  normalizeEventChestDirectRequestId
} from "./eventChestDirectOpenings.js";

function requiredText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildEventChestDirectOpeningTransactionId(requestId) {
  const safeRequestId = normalizeEventChestDirectRequestId(requestId);
  if (!safeRequestId) {
    return null;
  }
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ purpose: "event_chest_direct_open", requestId: safeRequestId }))
    .digest("hex");
  return `event_chest_direct_open_${digest.slice(0, 32)}`;
}

export function createEventChestDirectOpeningSettlement(input = {}) {
  const transactionId =
    requiredText(input.transactionId) ??
    buildEventChestDirectOpeningTransactionId(input.requestId);
  const settlement = normalizeEventChestDirectOpeningSettlement({
    schemaVersion: EVENT_CHEST_DIRECT_OPENING_SETTLEMENT_SCHEMA_VERSION,
    ...input,
    openingId: input.openingId ?? transactionId,
    transactionId
  });
  if (!settlement) {
    throw Object.assign(new Error("Event Chest direct opening settlement is invalid."), {
      code: "EVENT_CHEST_DIRECT_OPEN_SETTLEMENT_INVALID"
    });
  }
  return settlement;
}
