export const EVENT_CHEST_MAX_ACTIVE_WINDOWS = 50;
export const EVENT_CHEST_SCHEDULE_STATES = Object.freeze([
  "unscheduled",
  "upcoming",
  "active",
  "between_windows",
  "ended",
  "invalid"
]);

const ABSOLUTE_ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const ACTIVE_WINDOW_FIELDS = new Set(["startsAt", "endsAt"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAbsoluteTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text || !ABSOLUTE_ISO_TIMESTAMP.test(text)) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function cloneWindow(window) {
  return window ? { startsAt: window.startsAt, endsAt: window.endsAt } : null;
}

export function normalizeEventChestActiveWindows(activeWindows) {
  const errors = [];
  if (!Array.isArray(activeWindows)) {
    return {
      ok: false,
      windows: [],
      errors: ["activeWindows must be an array."]
    };
  }
  if (activeWindows.length > EVENT_CHEST_MAX_ACTIVE_WINDOWS) {
    errors.push(`activeWindows must contain at most ${EVENT_CHEST_MAX_ACTIVE_WINDOWS} windows.`);
  }

  const windows = [];
  for (const [index, window] of activeWindows.entries()) {
    if (!isObject(window)) {
      errors.push(`activeWindows[${index}] must be an object.`);
      continue;
    }

    for (const field of Object.keys(window)) {
      if (!ACTIVE_WINDOW_FIELDS.has(field)) {
        errors.push(`activeWindows[${index}].${field} is unsupported.`);
      }
    }

    const startsAt = normalizeAbsoluteTimestamp(window.startsAt);
    const endsAt = normalizeAbsoluteTimestamp(window.endsAt);
    if (!startsAt) {
      errors.push(
        `activeWindows[${index}].startsAt must be an absolute ISO 8601 timestamp with Z or an explicit offset.`
      );
    }
    if (!endsAt) {
      errors.push(
        `activeWindows[${index}].endsAt must be an absolute ISO 8601 timestamp with Z or an explicit offset.`
      );
    }
    if (!startsAt || !endsAt) {
      continue;
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      errors.push(`activeWindows[${index}].endsAt must be later than startsAt.`);
      continue;
    }
    windows.push({ startsAt, endsAt });
  }

  windows.sort(
    (left, right) =>
      Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
      Date.parse(left.endsAt) - Date.parse(right.endsAt)
  );

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    if (current.startsAt === previous.startsAt && current.endsAt === previous.endsAt) {
      errors.push(
        `activeWindows contains duplicate window '${current.startsAt}' to '${current.endsAt}'.`
      );
      continue;
    }
    if (Date.parse(current.startsAt) < Date.parse(previous.endsAt)) {
      errors.push(
        `activeWindows contains overlapping windows ending '${previous.endsAt}' and starting '${current.startsAt}'.`
      );
    }
  }

  return {
    ok: errors.length === 0,
    windows,
    errors
  };
}

export function evaluateEventChestSchedule(definitionOrWindows, { nowMs = Date.now() } = {}) {
  const activeWindows = Array.isArray(definitionOrWindows)
    ? definitionOrWindows
    : definitionOrWindows?.activeWindows;
  const normalized = normalizeEventChestActiveWindows(activeWindows ?? []);
  const evaluatedMs =
    typeof nowMs === "number" ? nowMs : Date.parse(String(nowMs ?? ""));
  const evaluatedAt = Number.isFinite(evaluatedMs)
    ? new Date(evaluatedMs).toISOString()
    : null;

  if (!normalized.ok || !evaluatedAt) {
    return {
      configured: Array.isArray(activeWindows) && activeWindows.length > 0,
      isWithinSchedule: false,
      state: "invalid",
      currentWindow: null,
      nextWindow: null,
      previousWindow: null,
      startsAt: null,
      endsAt: null,
      evaluatedAt,
      errors: evaluatedAt ? [...normalized.errors] : ["nowMs must be a valid timestamp."]
    };
  }

  if (normalized.windows.length === 0) {
    return {
      configured: false,
      isWithinSchedule: true,
      state: "unscheduled",
      currentWindow: null,
      nextWindow: null,
      previousWindow: null,
      startsAt: null,
      endsAt: null,
      evaluatedAt,
      errors: []
    };
  }

  let currentWindow = null;
  let nextWindow = null;
  let previousWindow = null;
  for (const window of normalized.windows) {
    const startsMs = Date.parse(window.startsAt);
    const endsMs = Date.parse(window.endsAt);
    if (evaluatedMs >= startsMs && evaluatedMs < endsMs) {
      currentWindow = window;
      break;
    }
    if (endsMs <= evaluatedMs) {
      previousWindow = window;
      continue;
    }
    if (startsMs > evaluatedMs) {
      nextWindow = window;
      break;
    }
  }

  let state = "ended";
  if (currentWindow) {
    state = "active";
  } else if (!previousWindow && nextWindow) {
    state = "upcoming";
  } else if (previousWindow && nextWindow) {
    state = "between_windows";
  }

  const relevantWindow = currentWindow ?? nextWindow ?? previousWindow;
  return {
    configured: true,
    isWithinSchedule: Boolean(currentWindow),
    state,
    currentWindow: cloneWindow(currentWindow),
    nextWindow: cloneWindow(nextWindow),
    previousWindow: cloneWindow(previousWindow),
    startsAt: relevantWindow?.startsAt ?? null,
    endsAt: relevantWindow?.endsAt ?? null,
    evaluatedAt,
    errors: []
  };
}
