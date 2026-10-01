import { describe, it, expect } from "vitest";
import { contextBootstrap, renderPodPrompt } from "./recipe-prompt.js";

const BOOTSTRAP = contextBootstrap("re-cinq/lore");

describe("contextBootstrap", () => {
  it("names lore_assemble_context and lore_search_memory in that order", () => {
    expect(BOOTSTRAP.indexOf("lore_assemble_context")).toBeLessThan(
      BOOTSTRAP.indexOf("lore_search_memory"),
    );
  });

  it("says nothing is pre-loaded, the one fact the installed skill cannot know", () => {
    expect(BOOTSTRAP).toContain("nothing is pre-loaded");
  });

  it("carries no {placeholder} the subsystem would ship to the model verbatim", () => {
    expect(BOOTSTRAP).not.toMatch(/\{[A-Za-z0-9_.-]+\}/);
  });

  it("names the tools as the Lore MCP server's, so a CLI that prefixes them with the server still finds them", () => {
    expect(BOOTSTRAP).toContain("Lore MCP server");
  });

  it("tells the agent to pass the repo and to query with the subject of the work, not with the words of the instruction", () => {
    expect({
      repo: BOOTSTRAP.includes("`repo"),
      subject: BOOTSTRAP.includes("what the work is ABOUT"),
      instructionWordsRuledOut: BOOTSTRAP.includes(
        "not the words of this instruction",
      ),
    }).toEqual({ repo: true, subject: true, instructionWordsRuledOut: true });
  });

  it("names the run's own repo, so the pod's first call carries it without reading a git remote, and asks for owner/name when the run has none", () => {
    expect({
      named: BOOTSTRAP.includes('`repo: "re-cinq/lore"`'),
      repoLess: contextBootstrap("").includes("`repo` (owner/name)"),
    }).toEqual({ named: true, repoLess: true });
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
