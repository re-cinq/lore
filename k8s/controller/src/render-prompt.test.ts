import { describe, it, expect } from "vitest";
import { renderPrompt } from "./render-prompt.js";

describe("renderPrompt", () => {
  it("fills known {placeholders} from parameters", () => {
    expect(
      renderPrompt("Fix {ticket} on branch {branch}.", { ticket: "ENG-417", branch: "fix/login" }),
    ).toBe("Fix ENG-417 on branch fix/login.");
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderPrompt("Do {known} not {missing}.", { known: "this" })).toBe("Do this not {missing}.");
  });

  it("returns empty string for an undefined template", () => {
    expect(renderPrompt(undefined, { a: "b" })).toBe("");
  });

  it("leaves placeholders intact when no parameters are given", () => {
    expect(renderPrompt("Hello {name}", undefined)).toBe("Hello {name}");
  });

  it("substitutes the same placeholder in multiple positions", () => {
    expect(renderPrompt("{x} and {x}", { x: "1" })).toBe("1 and 1");
  });
});
