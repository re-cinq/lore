import { describe, expect, it } from "vitest";
import { builtOrAssembled } from "./built-or-assembled.js";

const TEMPLATE_ANSWER = {
  text: "<context>template sections</context>",
  sections: [{ header: "Conventions", tokens: 400, truncated: false }],
};

const assemble = async () => TEMPLATE_ANSWER;

describe("builtOrAssembled", () => {
  it("serves the template assembly when no model is named for the context use", async () => {
    expect(await builtOrAssembled(null, assemble)).toEqual({
      ...TEMPLATE_ANSWER,
      builder: "off",
    });
  });

  it("serves the template assembly with the reason when the builder throws", async () => {
    const failing = async () => {
      throw new Error("model refused: billing");
    };

    expect(await builtOrAssembled(failing, assemble)).toEqual({
      ...TEMPLATE_ANSWER,
      builder: "failed: model refused: billing",
    });
  });

  it("serves the builder's block as one Context builder section of its 4-chars-per-token size", async () => {
    const block = "## Repo primer\n".padEnd(400, "x");

    expect(await builtOrAssembled(async () => block, assemble)).toEqual({
      text: block,
      sections: [{ header: "Context builder", tokens: 100, truncated: false }],
      builder: "on",
    });
  });

  it("serves the template assembly when the builder writes nothing", async () => {
    expect(await builtOrAssembled(async () => "  ", assemble)).toEqual({
      ...TEMPLATE_ANSWER,
      builder: "failed: empty block",
    });
  });
});
