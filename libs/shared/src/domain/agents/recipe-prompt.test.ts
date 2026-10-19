import { describe, it, expect } from "vitest";
import { CONTEXT_BOOTSTRAP, renderPodPrompt } from "./recipe-prompt.js";

describe("CONTEXT_BOOTSTRAP", () => {
  it("names lore_assemble_context and lore_search_memory in that order", () => {
    expect(CONTEXT_BOOTSTRAP.indexOf("lore_assemble_context")).toBeLessThan(
      CONTEXT_BOOTSTRAP.indexOf("lore_search_memory"),
    );
  });

  it("says nothing is pre-loaded, the one fact the installed skill cannot know", () => {
    expect(CONTEXT_BOOTSTRAP).toContain("nothing is pre-loaded");
  });

  it("carries no {placeholder} the subsystem would ship to the model verbatim", () => {
    expect(CONTEXT_BOOTSTRAP).not.toMatch(/\{[A-Za-z0-9_.-]+\}/);
  });

  it("names the tools as the Lore MCP server's, so a CLI that prefixes them with the server still finds them", () => {
    expect(CONTEXT_BOOTSTRAP).toContain("Lore MCP server");
  });

  it("tells the agent to pass the repo and to query with the subject of the work, not with the words of the instruction", () => {
    expect({
      repo: CONTEXT_BOOTSTRAP.includes("`repo`"),
      subject: CONTEXT_BOOTSTRAP.includes("what the work is ABOUT"),
      instructionWordsRuledOut: CONTEXT_BOOTSTRAP.includes(
        "not the words of this instruction",
      ),
    }).toEqual({ repo: true, subject: true, instructionWordsRuledOut: true });
  });
});

describe("renderPodPrompt", () => {
  it("fills {prompt} and {context} from the CR parameters and leaves an unknown placeholder literal", () => {
    expect(
      renderPodPrompt("{prompt}\n\n{context}\n\n{typo}", {
        prompt: "Do the ticket.\n\n## CI reported failures on abc",
        context: "bootstrap",
      }),
    ).toEqual(
      "Do the ticket.\n\n## CI reported failures on abc\n\nbootstrap\n\n{typo}",
    );
  });

  it("substitutes a parameter value literally, never as a replacement pattern", () => {
    expect(
      renderPodPrompt("{prompt}", { prompt: "match $& and $1 here" }),
    ).toEqual("match $& and $1 here");
  });
});
