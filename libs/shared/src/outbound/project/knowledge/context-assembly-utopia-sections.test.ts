import { describe, it, expect } from "vitest";
import { widenedChunks } from "./context-assembly-utopia-sections.js";

const CONTENT = `File: specs/loop-pause/spec.md
Repository: re-cinq/lore
Kind: spec

# Loop pause

A loop pauses when its run fails on credit.

## Requirements

- FR4 — A paused loop's pill shows the reason, since when, and until when if the pause has an end, and links to the run that paused it. ([validated by draws the pause](apps/web-ui/src/x.test.tsx#L12))
- FR5 — Resuming a loop deletes its pause row.

## Out of scope

Billing.
`;

describe("widenedChunks", () => {
  it("grows a hit that starts mid-statement to the whole FR4 line under its heading", () => {
    expect(
      widenedChunks(CONTENT, [
        "until when if the pause has an end, and links to the run that paused it.",
      ]),
    ).toEqual([
      "## Requirements\n- FR4 — A paused loop's pill shows the reason, since when, and until when if the pause has an end, and links to the run that paused it. ([validated by draws the pause](apps/web-ui/src/x.test.tsx#L12))",
    ]);
  });

  it("gives two hits of one paragraph that paragraph once, under the document title", () => {
    expect(
      widenedChunks(CONTENT, ["A loop pauses when", "fails on credit."]),
    ).toEqual(["# Loop pause\nA loop pauses when its run fails on credit."]);
  });

  it("anchors a chunk that Utopia led with the document's heading path on its first line of prose, and widens it to the FR5 line", () => {
    expect(
      widenedChunks(CONTENT, [
        "# Loop pause\n\n## Requirements\n\n- FR5 — Resuming a loop deletes its pause row.\n\n## Out of scope",
      ]),
    ).toEqual([
      "## Requirements\n- FR5 — Resuming a loop deletes its pause row.",
    ]);
  });

  it("keeps a hit the document no longer contains as it came", () => {
    expect(widenedChunks(CONTENT, ["Text of an older version."])).toEqual([
      "Text of an older version.",
    ]);
  });
});
