import { describe, it, expect } from "vitest";
import { ConventionalComment } from "./conventional-comment.js";

describe("ConventionalComment", () => {
  it("renders label and subject as a bold header", () => {
    const comment = new ConventionalComment({
      label: "nit",
      subject: "reads clearer as displayName",
    });

    expect(comment.render()).toBe("**nit:** reads clearer as displayName");
  });

  it("renders the decoration in parentheses after the label", () => {
    const comment = new ConventionalComment({
      label: "issue",
      decoration: "blocking",
      subject: "user can be null here",
    });

    expect(comment.render()).toBe(
      "**issue (blocking):** user can be null here",
    );
  });

  it("appends a suggestion block after the header", () => {
    const comment = new ConventionalComment({
      label: "suggestion",
      subject: "guard before deref",
      suggestion: 'const name = user?.name ?? "anon";',
    });

    expect(comment.render()).toBe(
      '**suggestion:** guard before deref\n\n```suggestion\nconst name = user?.name ?? "anon";\n```',
    );
  });

  it("renders discussion between the header and the suggestion", () => {
    const comment = new ConventionalComment({
      label: "issue",
      subject: "null deref",
      discussion: "This path is reachable from the webhook handler.",
      suggestion: "const name = user?.name;",
    });

    expect(comment.render()).toBe(
      "**issue:** null deref\n\nThis path is reachable from the webhook handler.\n\n```suggestion\nconst name = user?.name;\n```",
    );
  });

  it("renders an empty suggestion block for a whole-line deletion", () => {
    const comment = new ConventionalComment({
      label: "suggestion",
      subject: "drop this line",
      suggestion: "",
    });

    expect(comment.render()).toBe(
      "**suggestion:** drop this line\n\n```suggestion\n\n```",
    );
  });
});
