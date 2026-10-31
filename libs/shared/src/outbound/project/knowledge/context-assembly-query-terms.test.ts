import { describe, it, expect } from "vitest";
import {
  codeQueryOf,
  mentionsAny,
  queryTerms,
} from "./context-assembly-query-terms.js";

const TICKET =
  "Show the pause on the loop pill\n\nEdit `apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/board.ts` so the pill shows `pause.reason`; reuse LoopPaused.tsx and loopEnabled (FR5 of specs/loop-pause/spec.md). Parent #4007. The run is DELETE /api/repos/{owner}/{repo}/loops/{key}/pause.";

describe("queryTerms", () => {
  it("reads the paths, member names, symbols, requirement ids and issue numbers the ticket names, once each, prose left out", () => {
    expect(queryTerms(TICKET)).toEqual([
      "apps/web-ui/src/app/repos/[owner]/[repo]/loops/board/board.ts",
      "pause.reason",
      "LoopPaused.tsx",
      "loopEnabled",
      "FR5",
      "specs/loop-pause/spec.md",
      "#4007",
      "/api/repos/{owner}/{repo}/loops/{key}/pause",
    ]);
  });

  it("reads no term from a ticket of plain prose", () => {
    expect(queryTerms("Make the digest shorter on quiet weeks.")).toEqual([]);
  });
});

describe("codeQueryOf", () => {
  it("searches code by the file names without their folders and the symbols, not by requirement ids, issue numbers or routes", () => {
    expect(codeQueryOf(queryTerms(TICKET))).toBe(
      "board.ts pause.reason LoopPaused.tsx loopEnabled spec.md",
    );
  });

  it("is null for a ticket that names no file or symbol", () => {
    expect(codeQueryOf(queryTerms("Make the digest shorter."))).toBeNull();
  });
});

describe("mentionsAny", () => {
  it("is true for a memory that names board.ts whatever its case and false for a DoD run of another ticket", () => {
    const terms = queryTerms(TICKET);

    expect(mentionsAny("Edited Board.ts to draw the pill", terms)).toBe(true);
    expect(mentionsAny("dod/4012: triage failed label on credit", terms)).toBe(
      false,
    );
  });
});
