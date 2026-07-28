import crypto from "node:crypto";

function normalizeRequiredString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildEventChestEntitlementId({
  accountId,
  profileKey,
  chestId,
  definitionRevisionId
} = {}) {
  const safeAccountId = normalizeRequiredString(accountId);
  const safeProfileKey = normalizeRequiredString(profileKey);
  const safeChestId = normalizeRequiredString(chestId);
  const safeDefinitionRevisionId = normalizeRequiredString(definitionRevisionId);
  if (!safeAccountId || !safeProfileKey || !safeChestId || !safeDefinitionRevisionId) {
    return null;
  }

  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        accountId: safeAccountId,
        profileKey: safeProfileKey,
        chestId: safeChestId,
        definitionRevisionId: safeDefinitionRevisionId
      })
    )
    .digest("hex");

  return `event_chest_entitlement_${digest.slice(0, 32)}`;
}
