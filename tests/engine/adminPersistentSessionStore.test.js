import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AdminPersistentSessionStore,
  hashAdminPersistentSessionToken
} from "../../src/multiplayer/adminPersistentSessionStore.js";

async function createTempDataDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("admin persistent session store serializes concurrent last-used writes", async () => {
  let nowMs = Date.parse("2026-06-24T00:00:00.000Z");
  const dataDir = await createTempDataDir("elemintz-admin-session-store-");
  const store = new AdminPersistentSessionStore({
    dataDir,
    now: () => {
      nowMs += 1000;
      return nowMs;
    }
  });

  const session = await store.issueSession({
    account: {
      username: "VampyrLee",
      profileKey: "VampyrLee",
      accountId: "admin-account-1",
      email: "insanevampyr@gmail.com"
    }
  });

  const resumes = await Promise.all(
    Array.from({ length: 24 }, () => store.resumeSession(session.token))
  );

  assert.equal(resumes.length, 24);
  assert.equal(resumes.every((entry) => entry.username === "VampyrLee"), true);

  const persistedPath = path.join(dataDir, "server-data", "admin-persistent-sessions.json");
  const persisted = JSON.parse(await fs.readFile(persistedPath, "utf8"));
  assert.equal(persisted.sessions.length, 1);
  assert.equal(persisted.sessions[0].tokenHash, hashAdminPersistentSessionToken(session.token));
  assert.equal(persisted.sessions[0].username, "VampyrLee");
  assert.equal(typeof persisted.sessions[0].lastUsedAt, "string");
  assert.equal(JSON.stringify(persisted).includes(session.token), false);
  assert.equal(JSON.stringify(persisted).includes("AdminPass"), false);

  const reloaded = new AdminPersistentSessionStore({
    dataDir,
    now: () => nowMs
  });
  const resumedAfterReload = await reloaded.resumeSession(session.token);
  assert.equal(resumedAfterReload.username, "VampyrLee");
});

test("admin persistent session store keeps revoke idempotent during queued mutations", async () => {
  let nowMs = Date.parse("2026-06-24T00:00:00.000Z");
  const dataDir = await createTempDataDir("elemintz-admin-session-revoke-");
  const store = new AdminPersistentSessionStore({
    dataDir,
    now: () => {
      nowMs += 1000;
      return nowMs;
    }
  });

  const first = await store.issueSession({
    account: {
      username: "VampyrLee",
      email: "insanevampyr@gmail.com"
    }
  });
  const second = await store.issueSession({
    account: {
      username: "CopyCell",
      email: "copycell@example.com"
    }
  });

  const results = await Promise.all([
    store.resumeSession(first.token),
    store.revokeSession(first.token),
    store.revokeSession(first.token),
    store.resumeSession(second.token)
  ]);

  const revokeResults = results.filter((entry) => Object.hasOwn(entry, "revoked"));
  assert.equal(revokeResults.filter((entry) => entry.revoked === true).length, 1);
  assert.equal(revokeResults.filter((entry) => entry.revoked === false).length, 1);

  const persistedPath = path.join(dataDir, "server-data", "admin-persistent-sessions.json");
  const persisted = JSON.parse(await fs.readFile(persistedPath, "utf8"));
  assert.equal(persisted.sessions.length, 2);
  const firstRecord = persisted.sessions.find(
    (entry) => entry.tokenHash === hashAdminPersistentSessionToken(first.token)
  );
  const secondRecord = persisted.sessions.find(
    (entry) => entry.tokenHash === hashAdminPersistentSessionToken(second.token)
  );
  assert.equal(typeof firstRecord?.revokedAt, "string");
  assert.equal(secondRecord?.revokedAt, null);
  assert.equal(secondRecord?.username, "CopyCell");
});
