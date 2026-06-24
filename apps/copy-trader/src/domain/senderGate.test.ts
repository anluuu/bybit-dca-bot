import { describe, expect, it } from "vitest";
import { isSenderAllowed } from "./senderGate.js";

describe("isSenderAllowed", () => {
  it("allows missing sender ids when sender enforcement is disabled", () => {
    expect(isSenderAllowed(new Set([6492923280]), null, false)).toBe(true);
  });

  it("rejects missing sender ids when sender enforcement is enabled", () => {
    expect(isSenderAllowed(new Set([6492923280]), null, true)).toBe(false);
  });
});
