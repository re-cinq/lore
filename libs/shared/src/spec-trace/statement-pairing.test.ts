import { describe, it, expect } from "vitest";
import { pairRewrites } from "./statement-pairing.js";

/**
 * statement-pairing — recovering "this became that" from two unordered sets.
 *
 * The graph knows a statement's old text; the head file knows the new one. It
 * does not know which new statement replaced which old one, because statements
 * have no stable identity across an edit (that is why the delta conflates
 * edited and deleted). Pairing by similarity is what lets the comment show a
 * real before/after instead of quoting text the file no longer contains.
 */
describe("pairRewrites", () => {
  it("pairs a lightly edited statement with its replacement", () => {
    expect(
      pairRewrites(
        ["The widget MUST render within 100ms."],
        ["The widget MUST render within 50ms."],
      ),
    ).toEqual(
      new Map([
        [
          "The widget MUST render within 100ms.",
          "The widget MUST render within 50ms.",
        ],
      ]),
    );
  });

  it("leaves a deleted statement unpaired rather than inventing a replacement", () => {
    expect(
      pairRewrites(
        ["The widget MUST render within 100ms."],
        ["Audit entries MUST carry the actor id."],
      ),
    ).toEqual(new Map([["The widget MUST render within 100ms.", null]]));
  });

  it("does not reuse one replacement for two different statements", () => {
    const pairs = pairRewrites(
      [
        "The widget MUST render within 100ms.",
        "The widget MUST render within 200ms.",
      ],
      ["The widget MUST render within 50ms."],
    );

    expect([...pairs.values()].filter((v) => v !== null)).toHaveLength(1);
  });

  it("picks the closest replacement when several are candidates", () => {
    expect(
      pairRewrites(
        ["Auth tokens MUST expire after 30 days."],
        [
          "Completely unrelated sentence about widgets.",
          "Auth tokens MUST expire after 7 days.",
        ],
      ).get("Auth tokens MUST expire after 30 days."),
    ).toEqual("Auth tokens MUST expire after 7 days.");
  });

  it("returns every statement unpaired when nothing was added", () => {
    expect(pairRewrites(["A MUST hold."], [])).toEqual(
      new Map([["A MUST hold.", null]]),
    );
  });
});
