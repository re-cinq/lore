import { describe, it, expect } from "vitest";
import {
  parseGapResult,
  sanitizeSvg,
  decideFeatureStatus,
  isPlanningPhase,
  type GapResult,
} from "./gap-result.js";

const validResult: GapResult = {
  architecture: {
    summary: "A Features tab backed by a planning Station.",
    components: [
      {
        name: "features port",
        responsibility: "persist feature lifecycle",
        touchpoints: ["lore.features", "lore.feature_iterations"],
      },
    ],
  },
  user_flows: [
    { name: "create draft", steps: ["open tab", "write prompt", "submit"] },
  ],
  mockups: [
    { title: "list", format: "svg", markup: '<svg viewBox="0 0 10 10"></svg>' },
  ],
  questions: [
    { id: "q1", question: "Which repos?", why: "scope", kind: "text" },
  ],
  draft_spec_markdown: "# Feature Specification: X",
};

describe("parseGapResult", () => {
  it("returns the parsed result for a valid payload", () => {
    expect(parseGapResult(structuredClone(validResult))).toEqual(validResult);
  });

  it("throws when draft_spec_markdown is missing", () => {
    const { draft_spec_markdown: _omit, ...rest } = validResult;
    expect(() => parseGapResult(rest)).toThrow(/draft_spec_markdown/);
  });

  it("throws when a choice question has no options", () => {
    const bad = structuredClone(validResult);
    bad.questions = [
      { id: "q2", question: "Pick one", why: "branching", kind: "choice" },
    ];
    expect(() => parseGapResult(bad)).toThrow(/options/);
  });

  it("accepts an absent split_suggestion", () => {
    expect(parseGapResult(structuredClone(validResult)).split_suggestion).toBeUndefined();
  });

  it("normalizes a component that uses description instead of responsibility", () => {
    const drift = {
      ...validResult,
      architecture: {
        summary: "uses description, omits touchpoints",
        components: [{ name: "feature-planning task type", description: "new task type entry" }],
      },
    };
    expect(parseGapResult(drift).architecture.components[0]).toEqual({
      name: "feature-planning task type",
      responsibility: "new task type entry",
      touchpoints: [],
    });
  });

  it("normalizes a mockup given as a bare svg string", () => {
    const drift = { ...validResult, mockups: ['<svg viewBox="0 0 10 10"></svg>'] };
    expect(parseGapResult(drift).mockups[0]).toEqual({
      title: "Mockup 1",
      format: "svg",
      markup: '<svg viewBox="0 0 10 10"></svg>',
    });
  });

  it("normalizes a question that uses text and omits id and why", () => {
    const drift = {
      ...validResult,
      questions: [{ kind: "choice", options: ["a", "b"], text: "Which path?" }],
    };
    expect(parseGapResult(drift).questions[0]).toEqual({
      id: "q1",
      question: "Which path?",
      why: "",
      kind: "choice",
      options: ["a", "b"],
    });
  });
});

describe("sanitizeSvg", () => {
  it("strips a script element", () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')).toBe(
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

  it("strips an unquoted javascript: href", () => {
    expect(sanitizeSvg("<svg><a href=javascript:evil()>x</a></svg>")).toBe(
      "<svg><a>x</a></svg>",
    );
  });

  it("strips a foreignObject element", () => {
    expect(
      sanitizeSvg('<svg><foreignObject><div>x</div></foreignObject><rect/></svg>'),
    ).toBe("<svg><rect/></svg>");
  });

  it("keeps a clean svg with a fragment href unchanged", () => {
    const clean = '<svg viewBox="0 0 10 10"><use href="#a"/></svg>';
    expect(sanitizeSvg(clean)).toBe(clean);
  });
});

describe("decideFeatureStatus", () => {
  it("returns awaiting-input when questions are present", () => {
    expect(decideFeatureStatus(validResult)).toBe("awaiting-input");
  });

  it("returns awaiting-input when a split is suggested", () => {
    const withSplit: GapResult = {
      ...validResult,
      questions: [],
      split_suggestion: {
        rationale: "too big",
        proposed_features: [{ title: "A", scope: "part A" }],
      },
    };
    expect(decideFeatureStatus(withSplit)).toBe("awaiting-input");
  });

  it("returns spec-ready when no questions and no split", () => {
    expect(decideFeatureStatus({ ...validResult, questions: [] })).toBe(
      "spec-ready",
    );
  });
});

describe("isPlanningPhase", () => {
  it("returns true for the in-planning statuses", () => {
    expect(["draft", "planning", "awaiting-input", "spec-ready"].map(isPlanningPhase)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("returns false once the feature has left planning", () => {
    expect(["pr-open", "implemented", "split", "anything-else"].map(isPlanningPhase)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
