import { describe, it, expect } from "vitest";
import { explanationMarkdown } from "./explain-view.js";
import type { Explanation } from "./lore-client.js";

const statement = (text: string) => ({ text, via: "covered" as const });
const explained = (statements: Explanation["statements"]): Explanation => ({
  answer: "It spins the widget.",
  statements,
  model: "gemini-3-flash",
});

describe("explanationMarkdown", () => {
  it("renders the answer, then the statement it rests on with how it reaches the lines", () => {
    expect(
      explanationMarkdown(explained([statement("The widget spins.")])),
    ).toBe(
      [
        "It spins the widget.",
        "",
        "**Spec statements**",
        "",
        "- The widget spins. *(a test validating it runs these lines)*",
        "",
      ].join("\n"),
    );
  });

  it("renders the answer alone when no statement links the lines", () => {
    expect(explanationMarkdown(explained([]))).toBe("It spins the widget.\n");
  });

  it("lists 3 of 5 statements and says 2 more", () => {
    const markdown = explanationMarkdown(
      explained(["A.", "B.", "C.", "D.", "E."].map(statement)),
    );

    expect({
      listed: markdown.match(/^- /gm)?.length,
      more: markdown.trimEnd().split("\n").at(-1),
    }).toEqual({ listed: 3, more: "and 2 more" });
  });
});
