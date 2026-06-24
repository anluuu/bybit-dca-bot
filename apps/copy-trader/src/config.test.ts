import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = process.env;

const baseEnv = {
  TELEGRAM_API_ID: "12345",
  TELEGRAM_API_HASH: "hash",
  TELEGRAM_SESSION_STRING: "session",
  SIGNAL_CHANNEL_ID: "-1001234567890",
  TELEGRAM_NOTIFY_BOT_TOKEN: "token",
  TELEGRAM_NOTIFY_CHAT_ID: "chat",
  DATABASE_URL: "postgres://dca:password@localhost:5432/dca_bot",
  JWT_SECRET: "x".repeat(32),
};

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...originalEnv, ...baseEnv, ...env };
  return import("./config.js");
}

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

describe("copy-trader config", () => {
  it("treats an empty SIGNAL_TOPIC_ID as unset", async () => {
    const { config } = await loadConfig({ SIGNAL_TOPIC_ID: "" });

    expect(config.SIGNAL_TOPIC_ID).toBeUndefined();
  });

  it("rejects zero as a SIGNAL_TOPIC_ID", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit ${code}`);
    });

    await expect(loadConfig({ SIGNAL_TOPIC_ID: "0" })).rejects.toThrow(
      /process\.exit 1/
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
