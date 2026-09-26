import { describe, expect, it } from "vitest";
import { CliUsageError, parseSlot } from "../../src/cli/shared/slot";

describe("parseSlot", () => {
  it.each([
    [["--slot", "0"], 0],
    [["--slot", "1"], 1],
    [["--slot=0"], 0],
    [["--slot=1"], 1],
  ])("accepts %j", (argv, expected) => {
    expect(parseSlot(argv)).toBe(expected);
  });

  it.each([
    [[]],
    [["--slot"]],
    [["--slot", "2"]],
    [["--slot", "-1"]],
    [["--slot", "01"]],
    [["--slot", "a"]],
    [["--slot", "0", "--slot", "1"]],
    [["--slot", "0", "extra"]],
    [["--unknown", "0"]],
    [["0"]],
  ])("rejects %j", (argv) => {
    expect(() => parseSlot(argv)).toThrow(CliUsageError);
  });
});
