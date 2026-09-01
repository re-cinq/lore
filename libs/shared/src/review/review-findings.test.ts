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

  it("recovers a finding whose narrative field carries an unescaped quote", () => {
    // #1401, reproduced verbatim: the model free-writes a "discussion" string
    // and quotes a symbol inside it without escaping — a well-formed
    // REVIEW_FINDINGS block with one broken string value. JSON.parse alone
    // dies on the embedded `"` and the whole review is lost.
    const raw =
      '{"verdict":"changes_requested","findings":[{"path":"a.ts","line":1,"label":"issue","subject":"null deref","discussion":"the "foo" case is unguarded"}]}';

    expect(parseReviewFindings(block(raw))?.findings[0]).toMatchObject({
      discussion: 'the "foo" case is unguarded',
    });
  });

  it("recovers a finding whose narrative field carries a literal newline", () => {
    const raw =
      '{"verdict":"changes_requested","findings":[{"path":"a.ts","line":1,"label":"issue","subject":"s","discussion":"line one\nline two"}]}';

    expect(parseReviewFindings(block(raw))?.findings[0]?.discussion).toBe(
      "line one\nline two",
    );
  });

  it("recovers a finding whose suggestion carries a literal tab, same as newlines", () => {
    // A tabbed-indented code snippet in `suggestion` is a raw control
    // character, which JSON forbids unescaped in a string exactly like a raw
    // newline — the same class of bug, not a hypothetical.
    const raw =
      '{"verdict":"changes_requested","findings":[{"path":"a.ts","line":1,"label":"issue","subject":"s","suggestion":"if (x) {\treturn x;\t}"}]}';

    expect(parseReviewFindings(block(raw))?.findings[0]?.suggestion).toBe(
      "if (x) {\treturn x;\t}",
    );
  });

  it("still recovers when several findings each carry an unescaped quote", () => {
    const raw =
      '{"verdict":"changes_requested","findings":[' +
      '{"path":"a.ts","line":1,"label":"issue","subject":"s1","discussion":"has "x" here"},' +
      '{"path":"b.ts","line":2,"label":"nit","subject":"s2","discussion":"has "y" there"}' +
      "]}";

    expect(parseReviewFindings(block(raw))?.findings).toEqual([
      expect.objectContaining({ discussion: 'has "x" here' }),
      expect.objectContaining({ discussion: 'has "y" there' }),
    ]);
  });

  it("does not repair its way to a false positive on genuinely broken JSON", () => {
    expect(
      parseReviewFindings(block("{ verdict: changes_requested")),
    ).toBeNull();
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

describe("an optional field written as null", () => {
  // Models write `"suggestion": null` for a finding that has no suggestion, which
  // is the same statement as omitting the key. Read as a VALUE, it fails the type
  // check, `every` fails, and the whole block is discarded — so a review that
  // found ten things posts none of them and its node fails. That happened six
  // times on one PR on 2026-08-25 before anyone could see the findings.
  const block = (finding: string) =>
    [
      "```REVIEW_FINDINGS",
      `{"verdict":"changes_requested","summary":"s","findings":[${finding}]}`,
      "```",
    ].join("\n");

  const base = '"path":"a.ts","line":1,"subject":"s","label":"issue"';

  it("accepts null where the field is optional, since null and absent say the same thing", () => {
    const parsed = parseReviewFindings(block(`{${base},"suggestion":null}`));

    expect(parsed?.findings).toHaveLength(1);
  });

  it("keeps every OTHER finding when one carries a null optional", () => {
    const parsed = parseReviewFindings(
      block(`{${base},"suggestion":null},{${base},"suggestion":"do x"}`),
    );

    expect(parsed?.findings).toHaveLength(2);
  });

  it("still rejects a wrong TYPE in an optional field", () => {
    expect(parseReviewFindings(block(`{${base},"suggestion":42}`))).toBeNull();
  });
});

describe("the other findings schema this repo defines", () => {
  // Captured verbatim from the review of PR #1703 (run 5328bfa8, 2026-09-01):
  // valid JSON in a well-formed block, every finding rejected by the shape
  // check, so a real changes_requested review reached nobody.
  const REPORT_FINDINGS_SHAPE = `\`\`\`REVIEW_FINDINGS
{
  "verdict": "changes_requested",
  "summary": "Stale vitest coverage path reference should be removed.",
  "findings": [
    {
      "file": "apps/mcp-server/vitest.config.ts",
      "line": 14,
      "category": "cleanup",
      "short_summary": "Stale coverage include references non-existent path",
      "summary": "The coverage include points to a file that does not exist.",
      "failure_scenario": "The glob matches nothing, so the thresholds do not apply.",
      "verdict": "CONFIRMED"
    }
  ]
}
\`\`\``;

  it("reads file as path, short_summary as subject, and keeps the finding", () => {
    expect(parseReviewFindings(REPORT_FINDINGS_SHAPE)).toMatchObject({
      verdict: "changes_requested",
      findings: [
        {
          path: "apps/mcp-server/vitest.config.ts",
          line: 14,
          subject: "Stale coverage include references non-existent path",
          label: "issue",
        },
      ],
    });
  });

  it("carries summary and failure_scenario into the discussion so nothing is dropped", () => {
    const parsed = parseReviewFindings(REPORT_FINDINGS_SHAPE);

    expect(parsed?.findings[0].discussion).toEqual(
      "The coverage include points to a file that does not exist.\n\nThe glob matches nothing, so the thresholds do not apply.",
    );
  });

  it("takes a category only when it is one of our labels, never inventing a downgrade", () => {
    const asNit = REPORT_FINDINGS_SHAPE.replace(
      '"category": "cleanup"',
      '"category": "nit"',
    );

    expect(parseReviewFindings(asNit)?.findings[0].label).toEqual("nit");
  });

  it("leaves a finding already written the recipe's way untouched", () => {
    const canonical = `\`\`\`REVIEW_FINDINGS
{
  "verdict": "approved",
  "findings": [
    { "path": "src/a.ts", "line": 3, "label": "praise", "subject": "clean" }
  ]
}
\`\`\``;

    expect(parseReviewFindings(canonical)).toEqual({
      verdict: "approved",
      findings: [
        { path: "src/a.ts", line: 3, label: "praise", subject: "clean" },
      ],
    });
  });

  it("still rejects a finding carrying neither spelling of a required field", () => {
    const neither = `\`\`\`REVIEW_FINDINGS
{
  "verdict": "changes_requested",
  "findings": [{ "line": 14, "category": "cleanup" }]
}
\`\`\``;

    expect(parseReviewFindings(neither)).toBeNull();
  });
});
