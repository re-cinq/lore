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

  it("reads neither a link's URL nor its anchor, and not the generic spec.md, CLAUDE.md or README.md, from a ticket's References", () => {
    expect(
      queryTerms(
        "- [specs/loop-pause/spec.md#FR5](https://github.com/re-cinq/lore/blob/HEAD/specs/loop-pause/spec.md#fr5)\n\nRead CLAUDE.md and README.md first. Target file: `BoardView.tsx`.",
      ),
    ).toEqual(["specs/loop-pause/spec.md", "FR5", "BoardView.tsx"]);
  });
});

describe("codeQueryOf", () => {
  it("searches code by each file's name and its stem, and by the symbols, not by requirement ids, issue numbers, routes or spec.md", () => {
    expect(codeQueryOf(queryTerms(TICKET))).toBe(
      "board.ts board pause.reason LoopPaused.tsx LoopPaused loopEnabled",
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

  it("is false for a DoD run that cites FR5 and specs/other/spec.md but none of the ticket's files or symbols", () => {
    expect(
      mentionsAny(
        "dod/otto#156: FR5 done, see specs/other/spec.md",
        queryTerms(TICKET),
      ),
    ).toBe(false);
  });
});
