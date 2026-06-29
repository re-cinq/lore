import { describe, it, expect } from "vitest";
import { stationLogTail } from "./finalize-station-run.js";

describe("stationLogTail", () => {
  it("keeps the last lines (where the git error lives) and drops blanks", () => {
    const out = [
      "Cloning into '/workspace/repo'...",
      "",
      "remote: Repository not found.",
      "fatal: repository 'https://github.com/re-cinq/lore.git/' not found",
    ].join("\n");
    expect(stationLogTail(out)).toBe(
      "Cloning into '/workspace/repo'...\nremote: Repository not found.\nfatal: repository 'https://github.com/re-cinq/lore.git/' not found",
    );
  });

  it("returns empty for empty output", () => {
    expect(stationLogTail("   \n  ")).toBe("");
  });

  it("bounds to the last maxLines", () => {
    const out = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const tail = stationLogTail(out, 5);
    expect(tail.split("\n")).toHaveLength(5);
    expect(tail.endsWith("line 99")).toBe(true);
  });
});
