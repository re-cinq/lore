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
