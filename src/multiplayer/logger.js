export const SERVER_LOG_LABEL = "[EleMintz Server]";

function padTimestampPart(value) {
  return String(value).padStart(2, "0");
}

export function formatServerTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    padTimestampPart(date.getMonth() + 1),
    padTimestampPart(date.getDate())
  ].join("-") +
    " " +
    [
      padTimestampPart(date.getHours()),
      padTimestampPart(date.getMinutes()),
      padTimestampPart(date.getSeconds())
    ].join(":");
}

function prefixServerLogArgs(args, clock) {
  const prefix = `[${formatServerTimestamp(clock())}] ${SERVER_LOG_LABEL}`;
  if (args.length === 0) {
    return [prefix];
  }
  if (typeof args[0] === "string") {
    return [`${prefix} ${args[0]}`, ...args.slice(1)];
  }
  return [prefix, ...args];
}

export function createTimestampedLogger(baseLogger = console, { clock = () => new Date() } = {}) {
  const wrap = (methodName) => {
    const method =
      typeof baseLogger?.[methodName] === "function"
        ? baseLogger[methodName].bind(baseLogger)
        : typeof baseLogger?.log === "function"
          ? baseLogger.log.bind(baseLogger)
          : null;

    if (!method) {
      return () => {};
    }

    return (...args) => method(...prefixServerLogArgs(args, clock));
  };

  return {
    ...baseLogger,
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    log: wrap("log"),
    debug: wrap("debug")
  };
}

export const DEFAULT_TIMESTAMPED_LOGGER = createTimestampedLogger(console);
