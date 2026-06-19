import { JsonStore } from "./storage/jsonStore.js";

const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const FINAL_STATUSES = new Set(["completed", "rejected", "failed"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeStorePurchaseTransactionId(transactionId) {
  const normalized = String(transactionId ?? "").trim();
  return TRANSACTION_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized || null;
}

function normalizeEntry(entry = {}) {
  const transactionId = normalizeStorePurchaseTransactionId(entry.transactionId);
  if (!transactionId) {
    return null;
  }

  const status = FINAL_STATUSES.has(entry.status) ? entry.status : "processing";
  return {
    transactionId,
    buyerUsername: normalizeUsername(entry.buyerUsername),
    cosmeticType: String(entry.cosmeticType ?? "").trim() || null,
    cosmeticId: String(entry.cosmeticId ?? "").trim() || null,
    price: Number.isInteger(Number(entry.price)) ? Math.max(0, Number(entry.price)) : null,
    saleLimitMode: entry.saleLimitMode === "limited" ? "limited" : "unlimited",
    saleLimitSoldBefore: Math.max(0, Math.floor(Number(entry.saleLimitSoldBefore ?? 0) || 0)),
    saleLimitSoldAfter: Math.max(0, Math.floor(Number(entry.saleLimitSoldAfter ?? 0) || 0)),
    royaltyEnabled: entry.royaltyEnabled === true,
    royaltyRecipientUsername: normalizeUsername(entry.royaltyRecipientUsername),
    royaltyTokenPercent: Math.max(0, Number(entry.royaltyTokenPercent ?? 0) || 0),
    royaltyAmount: Math.max(0, Math.floor(Number(entry.royaltyAmount ?? 0) || 0)),
    royaltyStatus: ["none", "pending", "paid", "skipped", "failed"].includes(entry.royaltyStatus)
      ? entry.royaltyStatus
      : "none",
    royaltyPaidAt: entry.royaltyPaidAt ? String(entry.royaltyPaidAt) : null,
    royaltyNotificationStatus: String(entry.royaltyNotificationStatus ?? "none"),
    status,
    timestamp: String(entry.timestamp ?? new Date().toISOString()),
    completedAt: entry.completedAt ? String(entry.completedAt) : null,
    result: clone(entry.result),
    error: entry.error
      ? {
          code: String(entry.error.code ?? "UNIQUE_PURCHASE_FAILED"),
          message: String(entry.error.message ?? "Unique purchase failed.")
        }
      : null,
    duplicateCount: Math.max(0, Math.floor(Number(entry.duplicateCount ?? 0) || 0)),
    lastDuplicateAt: entry.lastDuplicateAt ? String(entry.lastDuplicateAt) : null
  };
}

export class StorePurchaseLedgerStore {
  constructor(options = {}) {
    this.store = new JsonStore("store-purchase-ledger.json", options);
    this.mutationQueue = Promise.resolve();
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  }

  runMutation(task) {
    const run = this.mutationQueue.then(task, task);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async listEntries() {
    const entries = await this.store.read([]);
    return (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(Boolean);
  }

  async getByTransactionId(transactionId) {
    const safeTransactionId = normalizeStorePurchaseTransactionId(transactionId);
    if (!safeTransactionId) {
      return null;
    }
    return clone(
      (await this.listEntries()).find((entry) => entry.transactionId === safeTransactionId) ?? null
    );
  }

  async beginTransaction(entry) {
    return this.runMutation(async () => {
      const normalized = normalizeEntry({
        ...entry,
        status: "processing",
        timestamp: entry?.timestamp ?? this.now()
      });
      if (!normalized) {
        throw new Error("A valid transactionId is required for Unique purchases.");
      }

      const entries = await this.listEntries();
      const existing = entries.find((candidate) => candidate.transactionId === normalized.transactionId);
      if (existing) {
        return { duplicate: true, entry: clone(existing) };
      }

      entries.push(normalized);
      await this.store.write(entries);
      return { duplicate: false, entry: clone(normalized) };
    });
  }

  async finalizeTransaction({
    transactionId,
    status,
    result = null,
    error = null,
    updates = {}
  }) {
    return this.runMutation(async () => {
      const safeTransactionId = normalizeStorePurchaseTransactionId(transactionId);
      if (!safeTransactionId) {
        throw new Error("A valid transactionId is required for Unique purchases.");
      }
      if (!FINAL_STATUSES.has(status)) {
        throw new Error(`Invalid Store purchase transaction status '${String(status ?? "")}'.`);
      }

      const entries = await this.listEntries();
      const index = entries.findIndex((entry) => entry.transactionId === safeTransactionId);
      if (index === -1) {
        throw new Error(`Unknown Store purchase transaction '${safeTransactionId}'.`);
      }

      entries[index] = normalizeEntry({
        ...entries[index],
        ...(updates && typeof updates === "object" && !Array.isArray(updates) ? updates : {}),
        status,
        result,
        error,
        completedAt: this.now()
      });
      await this.store.write(entries);
      return clone(entries[index]);
    });
  }

  async markDuplicate(transactionId) {
    return this.runMutation(async () => {
      const safeTransactionId = normalizeStorePurchaseTransactionId(transactionId);
      if (!safeTransactionId) {
        return null;
      }
      const entries = await this.listEntries();
      const index = entries.findIndex((entry) => entry.transactionId === safeTransactionId);
      if (index === -1) {
        return null;
      }
      entries[index] = normalizeEntry({
        ...entries[index],
        duplicateCount: entries[index].duplicateCount + 1,
        lastDuplicateAt: this.now()
      });
      await this.store.write(entries);
      return clone(entries[index]);
    });
  }
}
