import { describe, it, expect } from "vitest";
import { sectionsOf } from "./feature-types";
import type { GapResult } from "./feature-types";

// Unit coverage for the web-ui mirror's legacy-shape normalization (the branch the
// parity test intentionally skips because shared renders it richer). Keeps old stored
// results — pre-dynamic-sections — rendering.
describe("sectionsOf legacy normalization (web-ui mirror)", () => {
  const legacy: GapResult = {
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
      { title: "arch", format: "svg", markup: "<svg/>" }, // no section → defaults to architecture bucket
      { title: "flow", format: "svg", markup: "<svg/>", section: "user_flows" },
    ],
    questions: [
      { id: "q1", question: "Which repos?", why: "scope", kind: "text" },
    ],
    draft_spec_markdown: "# Spec",
  };

  it("derives Architecture, User flows, and Open questions sections in order", () => {
    expect(sectionsOf(legacy).map((s) => s.title)).toEqual([
      "Architecture",
      "User flows",
      "Open questions",
    ]);
  });

  it("bolds components in Architecture content and attaches its default-bucketed mockup", () => {
    const arch = sectionsOf(legacy)[0];
    expect(arch.content).toContain("- **features port**: persist lifecycle");
    expect(arch.mockups?.[0].title).toBe("arch");
  });

  it("numbers user-flow steps and attaches the user_flows-tagged mockup", () => {
    const flows = sectionsOf(legacy)[1];
    expect(flows.content).toContain("**create draft**");
    expect(flows.content).toContain("1. open tab");
    expect(flows.content).toContain("2. submit");
    expect(flows.mockups?.[0].title).toBe("flow");
  });

  it("carries legacy questions into an Open questions section", () => {
    expect(sectionsOf(legacy)[2].questions?.[0].question).toBe("Which repos?");
  });

  it("omits mockups when an architecture has none, with content from the summary alone", () => {
    const minimal: GapResult = {
      architecture: { summary: "just a summary", components: [] },
      draft_spec_markdown: "x",
    };
    expect(sectionsOf(minimal)[0]).toEqual({
      title: "Architecture",
      content: "just a summary",
    });
  });

  it("tolerates a componentless architecture and user_flows with no tagged mockup", () => {
    // Old rows may omit architecture.components and carry no diagrams.
    const g = {
      architecture: { summary: "sum" },
      user_flows: [{ name: "flow", steps: ["a"] }],
      draft_spec_markdown: "x",
    } as unknown as GapResult;
    const sections = sectionsOf(g);
    expect(sections.map((s) => s.title)).toEqual([
      "Architecture",
      "User flows",
    ]);
    expect(sections[0].content).toBe("sum"); // components ?? [] → summary only, no bullets
    expect(sections[1].mockups).toBeUndefined(); // no user_flows-tagged mockup → mockups omitted
  });

  it("returns [] for undefined and for an unrecognized shape", () => {
    expect(sectionsOf(undefined)).toEqual([]);
    expect(sectionsOf({} as GapResult)).toEqual([]);
  });
});
