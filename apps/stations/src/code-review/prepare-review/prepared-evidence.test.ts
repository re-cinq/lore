import { describe, expect, it } from "vitest";
import { pagedPacket, preparedEvidence } from "./prepared-evidence.js";

const collected = {
  code_evidence: { mode: "code", files: [{ path: "limit.ts" }] },
  test_evidence: { mode: "tests", files: [] },
  intent_evidence: { mode: "intent", discussion: [] },
  challenge_evidence: { mode: "test challenge", files: [] },
  product_evidence: { mode: "product", specs: [] },
};

describe("preparedEvidence", () => {
  it("returns the five packets the collector printed", () => {
    expect(preparedEvidence(JSON.stringify(collected))).toEqual(collected);
  });

  it("adds the previous findings to the product packet of a re-check", () => {
    expect(
      preparedEvidence(JSON.stringify(collected), "limit.ts:1 off by one"),
    ).toMatchObject({
      product_evidence: {
        mode: "product",
        specs: [],
        previous_findings: "limit.ts:1 off by one",
      },
    });
  });

  it.each(["whole_diff", "superseded"])(
    "returns the outcome %s when the collector answers it in place of packets",
    (status) => {
      expect(
        preparedEvidence(JSON.stringify({ status, reason: "a.bin" })),
      ).toBe(status);
    },
  );
});

describe("pagedPacket", () => {
  it("writes a file's text as one numbered line per source line, so a reader can open any part of a large packet", () => {
    const packet = {
      mode: "code",
      files: [
        {
          path: "limit.ts",
          before: "const a = 1;\nexport { a };",
          after: null,
        },
      ],
    };

    expect(pagedPacket(packet).split("\n")).toEqual([
      "{",
      ' "mode": "code",',
      ' "files": [',
      "  {",
      '   "path": "limit.ts",',
      '   "before": [',
      '    "1| const a = 1;",',
      '    "2| export { a };"',
      "   ],",
      '   "after": null',
      "  }",
      " ]",
      "}",
    ]);
  });
});
