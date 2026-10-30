import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loopOfLine, NOT_A_LOOP } from "./loop-of-line.js";

const PIPELINES = fileURLToPath(
  new URL("../../../../assembly-lines/src/floor-pipelines/", import.meta.url),
);

describe("loopOfLine", () => {
  it("returns implementation for implementation-loop", () => {
    expect(loopOfLine("implementation-loop")).toBe("implementation");
  });

  it("returns review for every code-review line", () => {
    expect(
      ["code-review", "code-review-recheck", "code-review-reply"].map(
        loopOfLine,
      ),
    ).toEqual(["review", "review", "review"]);
  });

  it("returns merge, triage, upkeep, digest and tickets for their lines", () => {
    expect(
      [
        "auto-merge",
        "issue-triage",
        "spec-upkeep",
        "daily-digest",
        "spec-tickets",
      ].map(loopOfLine),
    ).toEqual(["merge", "triage", "upkeep", "digest", "tickets"]);
  });

  it("returns null for onboard", () => {
    expect(loopOfLine("onboard")).toBeNull();
  });

  it("names every floor pipeline either a loop's line or not a loop", () => {
    const lineIds = readdirSync(PIPELINES)
      .filter((file) => file.endsWith(".yaml"))
      .map(
        (file) =>
          /^\s*id:\s*(\S+)/m.exec(readFileSync(PIPELINES + file, "utf8"))?.[1],
      );
    const undecided = lineIds.filter(
      (id) => !id || (loopOfLine(id) === null && !NOT_A_LOOP.includes(id)),
    );

    expect(undecided).toEqual([]);
  });
});
