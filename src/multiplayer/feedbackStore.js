import fs from "node:fs/promises";
import path from "node:path";

export const VALID_FEEDBACK_CATEGORIES = Object.freeze([
  "Bug / Error",
  "Balance Issue",
  "AI Too Easy/Hard",
  "Reward / Chest Issue",
  "Online Room Issue",
  "Login / Profile Issue",
  "Suggestion",
  "Other"
]);

const VALID_FEEDBACK_CATEGORY_SET = new Set(VALID_FEEDBACK_CATEGORIES);
const MAX_MESSAGE_LENGTH = 2000;
const MAX_USERNAME_LENGTH = 64;
const MAX_CONTEXT_FIELD_LENGTH = 256;
const MAX_RECENT_ERROR_LENGTH = 400;

function createValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeText(value, maxLength) {
  const normalized = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function sanitizeMessage(message) {
  const normalized = String(message ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!normalized) {
    throw createValidationError("FEEDBACK_MESSAGE_REQUIRED", "Please enter a feedback message.");
  }

  if (normalized.length > MAX_MESSAGE_LENGTH) {
    throw createValidationError(
      "FEEDBACK_MESSAGE_TOO_LONG",
      `Feedback messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`
    );
  }

  return normalized;
}

function sanitizeCategory(category) {
  const normalized = sanitizeText(category, 64);
  if (!normalized || !VALID_FEEDBACK_CATEGORY_SET.has(normalized)) {
    throw createValidationError("FEEDBACK_CATEGORY_INVALID", "Please choose a valid feedback category.");
  }
  return normalized;
}

function sanitizeUsername(username) {
  return sanitizeText(username, MAX_USERNAME_LENGTH);
}

function sanitizeClientContext(clientContext) {
  if (!clientContext || typeof clientContext !== "object" || Array.isArray(clientContext)) {
    return null;
  }

  const sanitized = {
    appVersion: sanitizeText(clientContext.appVersion, 64),
    platform: sanitizeText(clientContext.platform, 64),
    screen: sanitizeText(clientContext.screen, MAX_CONTEXT_FIELD_LENGTH),
    connectionStatus: sanitizeText(clientContext.connectionStatus, 64),
    mode: sanitizeText(clientContext.mode, 64),
    pveDifficulty: sanitizeText(clientContext.pveDifficulty, 64),
    roomCode: sanitizeText(clientContext.roomCode, 32),
    recentErrorMessage: sanitizeText(clientContext.recentErrorMessage, MAX_RECENT_ERROR_LENGTH)
  };

  const populatedEntries = Object.entries(sanitized).filter(([, value]) => value != null);
  if (!populatedEntries.length) {
    return null;
  }

  return Object.fromEntries(populatedEntries);
}

function createFeedbackId(random = Math.random) {
  const randomPart = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `fb_${Date.now().toString(36)}_${randomPart}`;
}

export class FeedbackStore {
  constructor({ dataDir, logger = console, random = Math.random } = {}) {
    if (!dataDir) {
      throw new Error("dataDir is required for FeedbackStore.");
    }

    this.dataDir = dataDir;
    this.logger = logger;
    this.random = random;
    this.filePath = path.join(dataDir, "server-data", "feedback.jsonl");
    this.writeQueue = Promise.resolve();
  }

  async appendFeedback({
    category,
    message,
    includeDebugInfo = true,
    username = null,
    clientContext = null,
    timestamp = new Date().toISOString()
  } = {}) {
    const safeCategory = sanitizeCategory(category);
    const safeMessage = sanitizeMessage(message);
    const safeUsername = sanitizeUsername(username);
    const safeIncludeDebugInfo = includeDebugInfo !== false;
    const safeClientContext = safeIncludeDebugInfo ? sanitizeClientContext(clientContext) : null;
    const entry = {
      feedbackId: createFeedbackId(this.random),
      timestamp,
      category: safeCategory,
      message: safeMessage,
      includeDebugInfo: safeIncludeDebugInfo,
      ...(safeUsername ? { user: { username: safeUsername } } : {}),
      ...(safeClientContext ? { client: safeClientContext } : {}),
      server: {
        receivedAt: timestamp,
        source: "multiplayer"
      }
    };

    return this.enqueueWrite(entry);
  }

  async enqueueWrite(entry) {
    const task = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
      return {
        feedbackId: entry.feedbackId,
        storedAt: entry.server.receivedAt,
        filePath: this.filePath,
        entry
      };
    });

    this.writeQueue = task.then(
      () => undefined,
      (error) => {
        this.logger?.warn?.("[Feedback] append failed", {
          message: error?.message ?? String(error)
        });
        return undefined;
      }
    );

    return task;
  }
}
