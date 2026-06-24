import { describe, expect, it } from "vitest";
import { parseReplayParsedArgs } from "./replayParsedArgs.js";

describe("parseReplayParsedArgs", () => {
  it("parses replay options", () => {
    expect(
      parseReplayParsedArgs(["--limit", "5", "--balance-usdt=250", "--oldest-first"])
    ).toEqual({
      limit: 5,
      balanceUsdt: 250,
      oldestFirst: true,
      help: false,
    });
  });

  it("rejects invalid numeric values", () => {
    expect(() => parseReplayParsedArgs(["--limit", "0"])).toThrow(/limit/);
    expect(() => parseReplayParsedArgs(["--balance-usdt", "0"])).toThrow(/balance-usdt/);
  });
});
