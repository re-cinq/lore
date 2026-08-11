import { describe, it, expect } from "vitest";
import {
  parseGapResult,
  sanitizeSvg,
  sanitizeGapResult,
  sectionsOf,
  decideFeatureStatus,
  isPlanningPhase,
  type GapResult,
} from "./gap-result.js";

const validResult: GapResult = {
  sections: [
    {
      title: "Overview",
      content: "A **Features tab** backed by a planning *Station*.",
    },
    {
      title: "Data model",
      content: "Store features + iterations.",
      mockups: [
        {
          title: "schema",
          format: "svg",
          markup: '<svg viewBox="0 0 10 10"></svg>',
        },
      ],
      questions: [
        {
          id: "q1",
          question: "Which repos?",
          why: "scope of the rollout",
          kind: "text",
        },
      ],
    },
  ],
  draft_spec_markdown:
    "# Feature Specification: X\n\n## Integration\nFits the repo page.",
};

const legacyPayload = {
  architecture: {
    summary: "A Features tab.",
    components: [
      {
        name: "features port",
        responsibility: "persist lifecycle",
        touchpoints: ["lore.features"],
      },
    ],
  },
  user_flows: [{ name: "create draft", steps: ["open tab", "submit"] }],
  mockups: [
    { title: "flow", format: "svg", markup: "<svg/>", section: "user_flows" },
  ],
  questions: [
    { id: "qq", question: "Which repos?", why: "scope", kind: "text" },
  ],
  draft_spec_markdown: "# Spec",
};

describe("parseGapResult", () => {
  it("returns the parsed result for a valid sections payload", () => {
    expect(parseGapResult(structuredClone(validResult))).toEqual(validResult);
  });

  it("throws when draft_spec_markdown is missing", () => {
    const { draft_spec_markdown: _omit, ...rest } = validResult;

    expect(() => parseGapResult(rest)).toThrow(/draft_spec_markdown/);
  });

  it("throws when a section's choice question has no options", () => {
    const bad = {
      sections: [
        {
          title: "Q",
          questions: [
            { id: "q2", question: "Pick one", why: "branch", kind: "choice" },
          ],
        },
      ],
      draft_spec_markdown: "x",
    };

    expect(() => parseGapResult(bad)).toThrow(/options/);
  });

  it("accepts an absent split_suggestion", () => {
    expect(
      parseGapResult(structuredClone(validResult)).split_suggestion,
    ).toBeUndefined();
  });

  it("normalizes a section question that uses text and omits id and why", () => {
    const drift = {
      sections: [
        {
          title: "Q",
          questions: [
            { kind: "choice", options: ["a", "b"], text: "Which path?" },
          ],
        },
      ],
      draft_spec_markdown: "x",
    };

    expect(parseGapResult(drift).sections[0].questions?.[0]).toEqual({
      id: "q1",
      question: "Which path?",
      why: "",
      kind: "choice",
      options: ["a", "b"],
    });
  });

  it("normalizes a section mockup given as a bare svg string", () => {
    const drift = {
      sections: [{ title: "D", mockups: ['<svg viewBox="0 0 10 10"></svg>'] }],
      draft_spec_markdown: "x",
    };

    expect(parseGapResult(drift).sections[0].mockups?.[0]).toEqual({
      title: "Mockup 1",
      format: "svg",
      markup: '<svg viewBox="0 0 10 10"></svg>',
    });
  });

  it("normalizes a legacy architecture/user_flows payload into sections", () => {
    const r = parseGapResult(structuredClone(legacyPayload));

    expect(r.sections.map((s) => s.title)).toEqual([
      "Architecture",
      "User flows",
      "Open questions",
    ]);
    expect(r.sections[0].content).toContain(
      "**features port**: persist lifecycle",
    );
    expect(r.sections[1].mockups?.[0].title).toBe("flow"); // tagged user_flows → attaches there
    expect(r.sections[2].questions?.[0].question).toBe("Which repos?");
  });

  it("throws when the root is null, an array, or a string", () => {
    for (const bad of [null, [], "{}"]) {
      expect(() => parseGapResult(bad)).toThrow(/root must be an object/);
    }
  });

  it("returns an empty sections list for an explicit empty sections array", () => {
    expect(parseGapResult({ sections: [], draft_spec_markdown: "x" })).toEqual({
      sections: [],
      draft_spec_markdown: "x",
    });
  });

  it("throws when a choice question has an explicit empty options array", () => {
    const bad = {
      sections: [
        {
          title: "Q",
          questions: [
            {
              id: "q3",
              question: "Pick",
              why: "branch",
              kind: "choice",
              options: [],
            },
          ],
        },
      ],
      draft_spec_markdown: "x",
    };

    expect(() => parseGapResult(bad)).toThrow(/options must be non-empty/);
  });

  it("throws when a split_suggestion omits proposed_features", () => {
    const bad = {
      sections: [{ title: "Overview", content: "x" }],
      split_suggestion: { rationale: "too big" },
      draft_spec_markdown: "x",
    };

    expect(() => parseGapResult(bad)).toThrow(
      /proposed_features must be an array/,
    );
  });
});

describe("sectionsOf", () => {
  it("returns the sections of a new-shape result", () => {
    expect(sectionsOf(validResult).map((s) => s.title)).toEqual([
      "Overview",
      "Data model",
    ]);
  });

  it("derives sections from a raw legacy-shape object", () => {
    expect(sectionsOf(legacyPayload).map((s) => s.title)).toEqual([
      "Architecture",
      "User flows",
      "Open questions",
    ]);
  });

  it("returns [] for null or unrecognized input", () => {
    expect(sectionsOf(null)).toEqual([]);
    expect(sectionsOf({ junk: 1 })).toEqual([]);
  });
});

describe("sanitizeSvg", () => {
  it("strips a script element", () => {
    expect(sanitizeSvg("<svg><script>alert(1)</script><rect/></svg>")).toBe(
      "<svg><rect/></svg>",
    );
  });

  it("strips an inline event handler attribute", () => {
    expect(sanitizeSvg('<svg onload="steal()"><rect/></svg>')).toBe(
      "<svg><rect/></svg>",
    );
  });

  it("strips a javascript: href", () => {
    expect(sanitizeSvg('<svg><a href="javascript:evil()">x</a></svg>')).toBe(
      "<svg><a>x</a></svg>",
    );
  });

  it("strips a foreignObject element", () => {
    expect(
      sanitizeSvg(
        "<svg><foreignObject><div>x</div></foreignObject><rect/></svg>",
      ),
    ).toBe("<svg><rect/></svg>");
  });

  it("keeps a clean svg with a fragment href unchanged", () => {
    const clean = '<svg viewBox="0 0 10 10"><use href="#a"/></svg>';

    expect(sanitizeSvg(clean)).toBe(clean);
  });
});

describe("sanitizeGapResult", () => {
  it("keeps a mermaid mockup's source and marks its format", () => {
    const drift = {
      sections: [
        {
          title: "Flow",
          mockups: [
            {
              title: "Pipeline",
              format: "mermaid",
              markup: "flowchart LR\n a --> b",
            },
          ],
        },
      ],
      draft_spec_markdown: "d",
    };

    expect(parseGapResult(drift).sections[0].mockups?.[0]).toEqual({
      title: "Pipeline",
      format: "mermaid",
      markup: "flowchart LR\n a --> b",
    });
  });

  it("keeps an html mockup's declared height", () => {
    const drift = {
      sections: [
        {
          title: "Panel",
          mockups: [
            {
              title: "Card",
              format: "html",
              markup: "<div class='card'>hi</div>",
              height: 180,
            },
          ],
        },
      ],
      draft_spec_markdown: "d",
    };

    expect(parseGapResult(drift).sections[0].mockups?.[0]).toMatchObject({
      format: "html",
      height: 180,
    });
  });

  it("falls back to svg for an unrecognized format naming svg markup", () => {
    const drift = {
      sections: [
        {
          title: "D",
          mockups: [{ title: "x", format: "diagram", markup: "<svg/>" }],
        },
      ],
      draft_spec_markdown: "d",
    };

    expect(parseGapResult(drift).sections[0].mockups?.[0].format).toBe("svg");
  });

  it("drops a mockup whose unrecognized format names no svg markup", () => {
    const drift = {
      sections: [
        {
          title: "D",
          mockups: [{ title: "x", format: "ascii", markup: "+---+" }],
        },
      ],
      draft_spec_markdown: "d",
    };

    expect(parseGapResult(drift).sections[0].mockups).toBeUndefined();
  });

  it("carries the result-level mockup stylesheet", () => {
    const drift = {
      sections: [{ title: "Overview" }],
      mockup_stylesheet: ".card { color: var(--text); }",
      draft_spec_markdown: "d",
    };

    expect(parseGapResult(drift).mockup_stylesheet).toBe(
      ".card { color: var(--text); }",
    );
  });

  it("sanitizes an html mockup and leaves mermaid source untouched", () => {
    const gap = parseGapResult({
      sections: [
        {
          title: "S",
          mockups: [
            {
              title: "a",
              format: "html",
              markup: "<div onclick='x()'>hi<script>bad()</script></div>",
            },
            { title: "b", format: "mermaid", markup: "flowchart LR\n a --> b" },
          ],
        },
      ],
      draft_spec_markdown: "d",
    });
    const [html, mermaid] = sanitizeGapResult(gap).sections[0].mockups ?? [];

    expect(html.markup).toBe("<div>hi</div>");
    expect(mermaid.markup).toBe("flowchart LR\n a --> b");
  });

  it("strips @import and url() from the mockup stylesheet", () => {
    const gap = parseGapResult({
      sections: [{ title: "S" }],
      mockup_stylesheet:
        "@import url('http://evil/x.css');\n.a { background: url(http://evil/x.png); color: red; }",
      draft_spec_markdown: "d",
    });

    expect(sanitizeGapResult(gap).mockup_stylesheet).toBe(
      "\n.a { background: none; color: red; }",
    );
  });

  it("sanitizes mockup markup across every section", () => {
    const g = parseGapResult({
      sections: [
        {
          title: "D",
          mockups: [
            {
              title: "m",
              format: "svg",
              markup: "<svg><script>x</script><rect/></svg>",
            },
          ],
        },
      ],
      draft_spec_markdown: "x",
    });

    expect(sanitizeGapResult(g).sections[0].mockups?.[0].markup).toBe(
      "<svg><rect/></svg>",
    );
  });
});

describe("decideFeatureStatus", () => {
  it("returns awaiting-input when any section has questions", () => {
    expect(decideFeatureStatus(validResult)).toBe("awaiting-input");
  });

  it("returns awaiting-input when a split is suggested", () => {
    const withSplit: GapResult = {
      sections: [{ title: "Overview", content: "x" }],
      split_suggestion: {
        rationale: "too big",
        proposed_features: [{ title: "A", scope: "part A" }],
      },
      draft_spec_markdown: "# spec",
    };

    expect(decideFeatureStatus(withSplit)).toBe("awaiting-input");
  });

  it("returns spec-ready when no section has questions and no split", () => {
    const ready: GapResult = {
      sections: [
        { title: "Overview", content: "x" },
        { title: "Data model", content: "y" },
      ],
      draft_spec_markdown: "# spec",
    };

    expect(decideFeatureStatus(ready)).toBe("spec-ready");
  });
});

describe("isPlanningPhase", () => {
  it("returns true for the in-planning statuses", () => {
    expect(
      ["draft", "planning", "awaiting-input", "spec-ready"].map(
        isPlanningPhase,
      ),
    ).toEqual([true, true, true, true]);
  });

  it("returns false once the feature has left planning", () => {
    expect(
      ["pr-open", "implemented", "split", "anything-else"].map(isPlanningPhase),
    ).toEqual([false, false, false, false]);
  });
});
