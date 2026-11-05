import { describe, it, expect } from "vitest";
import { explanationMarkdown } from "./explain-view.js";

const SPAN = { path: "src/widget.ts", start_line: 10, end_line: 12 };

describe("explanationMarkdown", () => {
  it("renders the answer under the file and lines, then the statements it rests on", () => {
    expect(
      explanationMarkdown(SPAN, {
        answer: "It spins the widget.",
        statements: [{ text: "The widget spins.", via: "covered" }],
        model: "gemini-3-flash",
      }),
    ).toBe(
      [
        "# src/widget.ts lines 10-12",
        "",
        "It spins the widget.",
        "",
        "## Spec statements",
        "",
        "- The widget spins. *(a test validating it runs these lines)*",
        "",
      ].join("\n"),
    );
  });

  it("renders the answer alone when no statement links the lines", () => {
    expect(
      explanationMarkdown(SPAN, {
        answer: "I don't know.",
        statements: [],
        model: null,
      }),
    ).toBe("# src/widget.ts lines 10-12\n\nI don't know.\n");
  });
});
