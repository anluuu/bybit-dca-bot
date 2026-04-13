const SENSITIVE_KEYS = new Set([
  "apikey",
  "apisecret",
  "secret",
  "token",
  "password",
]);

function stripSensitive(
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function log(
  level: "info" | "warn" | "error",
  msg: string,
  context?: Record<string, unknown>
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...stripSensitive(context),
  };
  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (msg: string, context?: Record<string, unknown>) =>
    log("info", msg, context),
  warn: (msg: string, context?: Record<string, unknown>) =>
    log("warn", msg, context),
  error: (msg: string, context?: Record<string, unknown>) =>
    log("error", msg, context),
};
