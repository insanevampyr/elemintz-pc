import { JsonStore } from "./storage/jsonStore.js";

function normalizeTransactionId(transactionId) {
  const normalized = String(transactionId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAdminId(adminId) {
  const normalized = String(adminId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeConfirmationStatus(status) {
  const normalized = String(status ?? "").trim();
  return normalized.length > 0 ? normalized : "pending";
}

function cloneEntry(entry) {
  return entry
    ? {
        ...entry,
        payload: entry.payload ? JSON.parse(JSON.stringify(entry.payload)) : null,
        result: entry.result ? JSON.parse(JSON.stringify(entry.result)) : null,
        error: entry.error ? { ...entry.error } : null
      }
    : null;
}

export class AdminGrantStore {
  constructor(options = {}) {
    this.store = new JsonStore("admin-grants.json", options);
    this.mutationQueue = Promise.resolve();
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
    return this.store.read([]);
  }

  async getByTransactionId(transactionId) {
    const safeTransactionId = normalizeTransactionId(transactionId);
    if (!safeTransactionId) {
      return null;
    }

    const entries = await this.listEntries();
    return cloneEntry(
      entries.find((entry) => normalizeTransactionId(entry?.transactionId) === safeTransactionId) ?? null
    );
  }

  async beginTransaction({
    transactionId,
    timestamp,
    adminId,
    targetUsername,
    grantType = "manual_reward_grant",
    payload,
    adminSocketId = null
  }) {
    return this.runMutation(async () => {
      const safeTransactionId = normalizeTransactionId(transactionId);
      if (!safeTransactionId) {
        throw new Error("transactionId is required.");
      }

      const entries = await this.listEntries();
      const existing =
        entries.find((entry) => normalizeTransactionId(entry?.transactionId) === safeTransactionId) ?? null;
      if (existing) {
        return {
          duplicate: true,
          entry: cloneEntry(existing)
        };
      }

      const nextEntry = {
        transactionId: safeTransactionId,
        timestamp: String(timestamp ?? new Date().toISOString()),
        adminIdentifier: normalizeAdminId(adminId),
        adminSocketId: String(adminSocketId ?? "").trim() || null,
        targetUsername: normalizeUsername(targetUsername),
        grantType: String(grantType ?? "manual_reward_grant").trim() || "manual_reward_grant",
        payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
        result: null,
        confirmationStatus: "pending",
        error: null,
        status: "processing",
        confirmedAt: null
      };

      entries.push(nextEntry);
      await this.store.write(entries);

      return {
        duplicate: false,
        entry: cloneEntry(nextEntry)
      };
    });
  }

  async finalizeTransaction({
    transactionId,
    status,
    result = null,
    confirmationStatus = null,
    error = null
  }) {
    return this.runMutation(async () => {
      const safeTransactionId = normalizeTransactionId(transactionId);
      if (!safeTransactionId) {
        throw new Error("transactionId is required.");
      }

      const entries = await this.listEntries();
      const index = entries.findIndex(
        (entry) => normalizeTransactionId(entry?.transactionId) === safeTransactionId
      );
      if (index === -1) {
        throw new Error(`Unknown admin grant transaction '${safeTransactionId}'.`);
      }

      const current = entries[index];
      const nextEntry = {
        ...current,
        status: String(status ?? current.status ?? "processing").trim() || "processing",
        result: result ? JSON.parse(JSON.stringify(result)) : current.result ?? null,
        confirmationStatus:
          confirmationStatus == null
            ? current.confirmationStatus ?? "pending"
            : normalizeConfirmationStatus(confirmationStatus),
        error: error ? { ...error } : null
      };

      entries[index] = nextEntry;
      await this.store.write(entries);
      return cloneEntry(nextEntry);
    });
  }

  async confirmTransaction({ transactionId, username }) {
    return this.runMutation(async () => {
      const safeTransactionId = normalizeTransactionId(transactionId);
      const safeUsername = normalizeUsername(username);
      if (!safeTransactionId) {
        throw new Error("transactionId is required.");
      }
      if (!safeUsername) {
        throw new Error("username is required.");
      }

      const entries = await this.listEntries();
      const index = entries.findIndex(
        (entry) => normalizeTransactionId(entry?.transactionId) === safeTransactionId
      );
      if (index === -1) {
        throw new Error(`Unknown admin grant transaction '${safeTransactionId}'.`);
      }

      const current = entries[index];
      if (normalizeUsername(current?.targetUsername) !== safeUsername) {
        throw new Error("Grant confirmation target mismatch.");
      }

      const nextEntry =
        current?.confirmationStatus === "confirmed"
          ? current
          : {
              ...current,
              confirmationStatus: "confirmed",
              confirmedAt: new Date().toISOString()
            };

      entries[index] = nextEntry;
      await this.store.write(entries);
      return cloneEntry(nextEntry);
    });
  }
}
