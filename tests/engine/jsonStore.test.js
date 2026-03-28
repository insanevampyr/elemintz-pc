import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../../src/state/storage/jsonStore.js";

const RealDate = Date;

function formatExpectedBackupTimestamp(isoValue) {
  const date = new RealDate(isoValue);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function mockDateSequence(isoValues) {
  let index = 0;

  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length > 0) {
        super(...args);
        return;
      }

      const value = isoValues[Math.min(index, isoValues.length - 1)];
      index += 1;
      super(value);
    }

    static now() {
      const value = isoValues[Math.min(index, isoValues.length - 1)];
      return new RealDate(value).valueOf();
    }
  };
}

test("jsonStore: write creates timestamped backups and retains the latest five", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-json-store-"));
  const store = new JsonStore("profiles.json", { dataDir });

  t.after(async () => {
    global.Date = RealDate;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  mockDateSequence([
    "2026-03-17T10:00:01.000Z",
    "2026-03-17T10:00:02.000Z",
    "2026-03-17T10:00:03.000Z",
    "2026-03-17T10:00:04.000Z",
    "2026-03-17T10:00:05.000Z",
    "2026-03-17T10:00:06.000Z"
  ]);

  await store.write([{ username: "Alpha", tokens: 200 }]);
  await store.write([{ username: "Alpha", tokens: 201 }]);
  await store.write([{ username: "Alpha", tokens: 202 }]);
  await store.write([{ username: "Alpha", tokens: 203 }]);
  await store.write([{ username: "Alpha", tokens: 204 }]);
  await store.write([{ username: "Alpha", tokens: 205 }]);
  await store.write([{ username: "Alpha", tokens: 206 }]);

  const entries = await fs.readdir(dataDir);
  const backups = entries
    .filter((entry) => entry.startsWith("profiles.json.backup-") && entry.endsWith(".json"))
    .sort();

  assert.equal(backups.length, 5);
  assert.deepEqual(backups, [
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-17T10:00:02.000Z")}.json`,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-17T10:00:03.000Z")}.json`,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-17T10:00:04.000Z")}.json`,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-17T10:00:05.000Z")}.json`,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-17T10:00:06.000Z")}.json`
  ]);

  const latest = JSON.parse(await fs.readFile(store.filePath, "utf8"));
  assert.deepEqual(latest, [{ username: "Alpha", tokens: 206 }]);
});

test("jsonStore: read recovers from the newest valid backup and restores the main file", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-json-store-recovery-"));
  const store = new JsonStore("profiles.json", { dataDir });

  t.after(async () => {
    global.Date = RealDate;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  mockDateSequence(["2026-03-18T08:00:00.000Z"]);

  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(
    store.filePath,
    JSON.stringify([{ username: "Stable", tokens: 321 }], null, 2),
    "utf8"
  );

  const backupPath = path.join(
    dataDir,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-18T08:00:00.000Z")}.json`
  );
  await fs.copyFile(store.filePath, backupPath);

  await fs.writeFile(store.filePath, "{broken-json", "utf8");

  const recovered = await store.read([]);
  assert.deepEqual(recovered, [{ username: "Stable", tokens: 321 }]);

  const restoredMain = JSON.parse(await fs.readFile(store.filePath, "utf8"));
  assert.deepEqual(restoredMain, [{ username: "Stable", tokens: 321 }]);
});

test("jsonStore: repeated writes in the same second keep distinct backups", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-json-store-collision-"));
  const store = new JsonStore("profiles.json", { dataDir });

  t.after(async () => {
    global.Date = RealDate;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  mockDateSequence([
    "2026-03-19T09:15:00.000Z",
    "2026-03-19T09:15:00.000Z",
    "2026-03-19T09:15:00.000Z"
  ]);

  await store.write([{ username: "Burst", tokens: 1 }]);
  await store.write([{ username: "Burst", tokens: 2 }]);
  await store.write([{ username: "Burst", tokens: 3 }]);

  const backups = (await fs.readdir(dataDir))
    .filter((entry) => entry.startsWith(`profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-19T09:15:00.000Z")}`) && entry.endsWith(".json"))
    .sort();

  assert.deepEqual(backups, [
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-19T09:15:00.000Z")}-01.json`,
    `profiles.json.backup-${formatExpectedBackupTimestamp("2026-03-19T09:15:00.000Z")}.json`
  ]);
});
