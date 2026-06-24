import { describe, expect, it } from "vitest";
import { parseBackfillArgs } from "./backfillArgs.js";

describe("parseBackfillArgs", () => {
  it("parses explicit backfill options", () => {
    expect(
      parseBackfillArgs([
        "--limit",
        "250",
        "--batch-size=25",
        "--before-id",
        "12345",
        "--dry-run",
      ])
    ).toEqual({
      limit: 250,
      batchSize: 25,
      beforeId: 12345,
      dryRun: true,
      help: false,
    });
  });

  it("rejects invalid numeric options", () => {
    expect(() => parseBackfillArgs(["--limit", "0"])).toThrow(/limit/);
    expect(() => parseBackfillArgs(["--batch-size", "101"])).toThrow(/batch-size/);
    expect(() => parseBackfillArgs(["--before-id", "-1"])).toThrow(/before-id/);
  });

  it("ignores the pnpm argument separator", () => {
    expect(parseBackfillArgs(["--", "--help"]).help).toBe(true);
  });
});
