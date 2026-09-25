import { describe, it, expect } from "vitest";
import {
  renderDigestDraft,
  renderRepoSection,
  renderThreadParent,
  splitDigestMessage,
  stripAppendix,
  APPENDIX_MARKER,
  ASIDE_MARKER,
  ENDING_MARKER,
  INTRO_MARKER,
} from "./render.js";
import { closedIssue, mergedPr, openIssue } from "./fixtures.js";
import { DIGEST_DEFAULTS } from "../../domain/digest-settings.js";

const all = { ...DIGEST_DEFAULTS, enabled: true };
const section = (
  overrides: Partial<Parameters<typeof renderRepoSection>[0]> = {},
) =>
  renderRepoSection({
    repo: "re-cinq/lore",
    settings: all,
    implemented: [
      { key: "alice", changes: [mergedPr({ number: 1, title: "Add digest" })] },
    ],
    roadmap: [
      { key: "bob", changes: [openIssue({ number: 20, title: "Roadmap" })] },
    ],
    ...overrides,
  });

describe("renderRepoSection", () => {
  it("links each item as slack mrkdwn", () => {
    expect(section()).toContain("• <https://gh/pr/1|Add digest> (#1)");
    expect(section()).toContain("• <https://gh/i/20|Roadmap> (#20)");
  });

  it("names the repo and the group as bold headers", () => {
    expect(section()).toContain("*re-cinq/lore*");
    expect(section()).toContain("*alice*");
  });

  it("caps roadmap items at 10 and counts the rest", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) =>
      openIssue({ number: 100 + i, title: `Issue ${i}` }),
    );
    const text = section({ roadmap: [{ key: "bob", changes: thirteen }] });

    expect(text).toContain("Issue 9");
    expect(text).not.toContain("Issue 10");
    expect(text).toContain("+3 more");
  });

  it("shows a person under their Slack name when one is known", () => {
    const text = section({ names: { alice: "Alice Smith" } });

    expect(text).toContain("*Alice Smith*");
    expect(text).toContain("*bob*");
  });

  it("omits a section the repo did not enable", () => {
    const text = section({ settings: { ...all, sections: ["roadmap"] } });

    expect(text).not.toContain("Implemented");
    expect(text).toContain("Roadmap");
  });

  it("says so when nothing was implemented", () => {
    expect(section({ implemented: [] })).toContain("Nothing merged or closed");
  });

  it("renders a failed repo read as its own section", () => {
    expect(section({ error: "GitHub 502" })).toBe(
      "*re-cinq/lore*\n_could not read re-cinq/lore: GitHub 502_",
    );
  });

  it("lists a closed issue with its number", () => {
    const text = section({
      implemented: [
        { key: "carol", changes: [closedIssue({ number: 12, title: "Bug" })] },
      ],
    });

    expect(text).toContain("• <https://gh/i/12|Bug> (#12)");
  });
});

describe("section asides", () => {
  it("puts one aside marker after each enabled section when asked", () => {
    const text = section({ asides: true });

    expect(
      text.split("\n").filter((line) => line === ASIDE_MARKER),
    ).toHaveLength(2);
    expect(text.indexOf(ASIDE_MARKER)).toBeGreaterThan(
      text.indexOf("Add digest"),
    );
  });

  it("puts no aside marker when not asked", () => {
    expect(section()).not.toContain(ASIDE_MARKER);
  });
});

describe("renderDigestDraft", () => {
  const draft = (overrides = {}) =>
    renderDigestDraft({
      header: { weekKey: "2026-W39", date: "2026-09-25" },
      sections: ["*re-cinq/lore*\n_section_"],
      wantsIntro: true,
      wantsEnding: true,
      recent: [{ intro: "Old intro", ending: "Old ending" }],
      ...overrides,
    });

  it("renders one section per repo between the intro and ending markers", () => {
    const text = draft({ sections: ["*a*\n1", "*b*\n2"] });

    expect(text.indexOf(INTRO_MARKER)).toBeLessThan(text.indexOf("*a*"));
    expect(text.indexOf("*a*")).toBeLessThan(text.indexOf("*b*"));
    expect(text.indexOf("*b*")).toBeLessThan(text.indexOf(ENDING_MARKER));
  });

  it("carries the recent intros and endings in the appendix", () => {
    const text = draft();

    expect(text.indexOf(APPENDIX_MARKER)).toBeGreaterThan(
      text.indexOf(ENDING_MARKER),
    );
    expect(text).toContain("Old intro");
    expect(text).toContain("Old ending");
  });

  it("names the voice in the appendix when one is set", () => {
    expect(draft({ voice: "Michael Scott from The Office" })).toContain(
      "Voice: Michael Scott from The Office",
    );
  });

  it("omits the intro marker when no repo asked for a summary", () => {
    const text = draft({ wantsIntro: false });

    expect(text).not.toContain(INTRO_MARKER);
    expect(text).toContain(ENDING_MARKER);
  });

  it("titles the draft with the date", () => {
    expect(draft()).toContain("Daily digest · 2026-09-25");
  });
});

describe("stripAppendix", () => {
  it("leaves only the message", () => {
    expect(stripAppendix(`body\n\n${APPENDIX_MARKER}\nold stuff`)).toBe("body");
  });

  it("removes aside markers a refine never filled", () => {
    expect(stripAppendix(`*repo*\n• item\n${ASIDE_MARKER}\n\n*next*`)).toBe(
      "*repo*\n• item\n\n*next*",
    );
  });

  it("removes the intro and ending markers a refine never filled", () => {
    expect(stripAppendix(`${INTRO_MARKER}\n\nbody\n\n${ENDING_MARKER}`)).toBe(
      "body",
    );
  });
});

describe("splitDigestMessage", () => {
  it("returns the first paragraph as intro and the last as ending", () => {
    expect(
      splitDigestMessage("Hello team.\n\n*repo*\n• item\n\nKeep going!"),
    ).toEqual({
      intro: "Hello team.",
      body: "*repo*\n• item",
      ending: "Keep going!",
    });
  });

  it("returns empty intro and ending for a one-paragraph message", () => {
    expect(splitDigestMessage("*repo*\n• item")).toEqual({
      intro: "",
      body: "*repo*\n• item",
      ending: "",
    });
  });
});

describe("renderThreadParent", () => {
  it("names the week and every repo", () => {
    expect(
      renderThreadParent("2026-W39", ["re-cinq/lore", "re-cinq/otto"]),
    ).toBe("Week 39 · re-cinq/lore, re-cinq/otto");
  });
});
