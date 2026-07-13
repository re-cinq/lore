import { describe, it, expect } from "vitest";
import {
  enforceFeatureInput,
  parseSectionAnswers,
  ValidationError,
} from "./feature-input.js";

describe("enforceFeatureInput", () => {
  it("trims and returns the title and prompt for valid input", () => {
    expect(
      enforceFeatureInput("  Smart Planning  ", "  do the thing  "),
    ).toEqual({
      title: "Smart Planning",
      prompt: "do the thing",
    });
  });

  it("throws a ValidationError when the title is blank or whitespace", () => {
    expect(() => enforceFeatureInput("   ", "p")).toThrow(
      new ValidationError("title and prompt are required"),
    );
  });

  it("throws a ValidationError when the prompt is missing", () => {
    expect(() => enforceFeatureInput("t", undefined)).toThrow(
      new ValidationError("title and prompt are required"),
    );
  });

  it("throws when the title exceeds the length cap", () => {
    expect(() => enforceFeatureInput("x".repeat(257), "p")).toThrow(
      /title must be 256 characters or fewer/,
    );
  });

  it("throws when the prompt exceeds the length cap", () => {
    expect(() => enforceFeatureInput("t", "x".repeat(8001))).toThrow(
      /prompt must be 8000 characters or fewer/,
    );
  });
});

describe("parseSectionAnswers", () => {
  it("returns null for non-object input", () => {
    for (const bad of [null, undefined, [], "x", 5]) {
      expect(parseSectionAnswers(bad)).toBeNull();
    }
  });

  it("returns null when every field is empty", () => {
    expect(
      parseSectionAnswers({ sections: {}, questions: {}, free_form: "" }),
    ).toBeNull();
  });

  it("keeps a valid direction and comment, dropping an unknown direction", () => {
    const parsed = parseSectionAnswers({
      sections: {
        Overview: { comment: "tighten scope", direction: "refine" },
        "Data model": { comment: "x", direction: "explode" },
      },
    });

    expect(parsed?.sections).toEqual({
      Overview: { comment: "tighten scope", direction: "refine" },
      "Data model": { comment: "x" },
    });
  });

  it("keeps only string question answers", () => {
    const parsed = parseSectionAnswers({
      questions: { q1: "yes", q2: 42, q3: null },
    });

    expect(parsed?.questions).toEqual({ q1: "yes" });
  });

  it("coerces free_form and fills empty section/question maps", () => {
    expect(parseSectionAnswers({ free_form: "ship it" })).toEqual({
      sections: {},
      questions: {},
      free_form: "ship it",
    });
  });
});
