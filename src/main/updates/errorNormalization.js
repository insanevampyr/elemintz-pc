function extractMessage(error) {
  if (error == null) {
    return "Unknown updater error.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  if (typeof error.error === "string" && error.error.trim()) {
    return error.error;
  }

  if (typeof error.description === "string" && error.description.trim()) {
    return error.description;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function normalizeUpdaterError(error) {
  if (error instanceof Error) {
    if (!error.message || !error.message.trim()) {
      error.message = extractMessage(error);
    }
    return error;
  }

  const normalized = new Error(extractMessage(error));

  if (error && typeof error === "object") {
    if (typeof error.name === "string" && error.name.trim()) {
      normalized.name = error.name;
    }

    if ("code" in error && error.code != null) {
      normalized.code = error.code;
    }

    if ("stack" in error && typeof error.stack === "string" && error.stack.trim()) {
      normalized.stack = error.stack;
    }

    normalized.details = error;
  }

  return normalized;
}
