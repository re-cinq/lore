import { describe, it, expect } from "vitest";
import { parseReviewFindings } from "./review-findings.js";

const block = (json: string): string =>
  `Here is my review.\n\n\`\`\`REVIEW_FINDINGS\n${json}\n\`\`\`\n\nREVIEW_RESULT:CHANGES_REQUESTED`;

describe("parseReviewFindings", () => {
  it("parses a valid findings block into a ReviewOutput", () => {
    const output = block(
      JSON.stringify({
        verdict: "changes_requested",
        summary: "one blocking issue",
        findings: [
          {
            path: "src/a.ts",
            line: 42,
            label: "issue",
            decoration: "blocking",
            subject: "null deref",
            suggestion: "const x = y ?? 0;",
          },
        ],
      }),
    );

    expect(parseReviewFindings(output)).toEqual({
      verdict: "changes_requested",
      summary: "one blocking issue",
      findings: [
        {
          path: "src/a.ts",
          line: 42,
          label: "issue",
          decoration: "blocking",
          subject: "null deref",
          suggestion: "const x = y ?? 0;",
        },
      ],
    });
  });

  it("returns null when no findings block is present", () => {
    expect(parseReviewFindings("REVIEW_RESULT:APPROVED")).toBeNull();
  });

  it("returns null when the block is not valid JSON", () => {
    expect(parseReviewFindings(block("{ not json"))).toBeNull();
  });

  it("returns null when a finding has an unknown label", () => {
    const output = block(
      JSON.stringify({
        verdict: "changes_requested",
        findings: [{ path: "a.ts", line: 1, label: "bug", subject: "x" }],
      }),
    );

    expect(parseReviewFindings(output)).toBeNull();
  });

  it("returns null when the verdict is missing", () => {
    const output = block(JSON.stringify({ findings: [] }));

    expect(parseReviewFindings(output)).toBeNull();
  });
});
