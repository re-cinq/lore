import { describe, it, expect } from "vitest";
import {
  renderChangelogLinks,
  renderDigestDraft,
  renderPeople,
  renderRepoFailure,
  renderThreadParent,
  splitDigestMessage,
  stripAppendix,
  APPENDIX_MARKER,
  INTRO_MARKER,
} from "./render.js";
import { closedIssue, mergedPr, openIssue, openPr } from "./fixtures.js";

const alice = {
  login: "alice",
  did: [mergedPr({ number: 1, title: "Add digest" })],
  next: [openIssue({ number: 20, title: "Roadmap" })],
};

describe("renderPeople", () => {
  it("puts alice's name on its own line above her did and next bullets", () => {
    expect(renderPeople([alice], {})).toEqual([
      "*alice*\n• did: <https://gh/pr/1|Add digest> (#1)\n• next: <https://gh/i/20|Roadmap> (#20)",
    ]);
  });

  it("leaves out a list the person has nothing in", () => {
    expect(renderPeople([{ ...alice, next: [] }], {})).toEqual([
      "*alice*\n• did: <https://gh/pr/1|Add digest> (#1)",
    ]);
  });

  it("lists a closed issue and an open PR with their numbers", () => {
    const [block] = renderPeople(
      [
        {
          login: "carol",
          did: [closedIssue({ number: 12, title: "Bug" })],
          next: [openPr({ number: 30, title: "Draft" })],
        },
      ],
      {},
    );

    expect(block).toBe(
      "*carol*\n• did: <https://gh/i/12|Bug> (#12)\n• next: <https://gh/pr/30|Draft> (#30)",
    );
  });

  it("lists all 5 merged titles under did with no +N more", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      mergedPr({
        number: 100 + i,
        title: `PR ${i}`,
        url: `https://gh/pr/${100 + i}`,
      }),
    );
    const [block] = renderPeople([{ login: "bob", did: five, next: [] }], {});

    expect(block).toBe(
      `*bob*\n• did: ${five.map((pr, i) => `<https://gh/pr/${100 + i}|PR ${i}> (#${pr.number})`).join(", ")}`,
    );
  });

  it("shows 3 next titles and counts the other 2 as +2 more", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      openPr({
        number: 100 + i,
        title: `PR ${i}`,
        url: `https://gh/pr/${100 + i}`,
      }),
    );
    const [block] = renderPeople([{ login: "bob", did: [], next: five }], {});

    expect(block).toBe(
      "*bob*\n• next: <https://gh/pr/100|PR 0> (#100), <https://gh/pr/101|PR 1> (#101), <https://gh/pr/102|PR 2> (#102), +2 more",
    );
  });

  it("shows Alice Smith for alice and sorts people by the name shown", () => {
    const blocks = renderPeople(
      [
        { ...alice, login: "zed" },
        { ...alice, login: "alice" },
      ],
      { zed: "Ana" },
    );

    expect(blocks.map((block) => block.split("\n")[0])).toEqual([
      "*alice*",
      "*Ana*",
    ]);
  });
});

describe("renderRepoFailure", () => {
  it("names the repo and the error", () => {
    expect(renderRepoFailure("re-cinq/lore", "GitHub 502")).toBe(
      "_could not read re-cinq/lore: GitHub 502_",
    );
  });
});

describe("renderDigestDraft", () => {
  const draft = (overrides = {}) =>
    renderDigestDraft({
      header: { weekKey: "2026-W39", date: "2026-09-25" },
      lines: ["*alice*\n• did: a", "*bob*\n• next: b"],
      wantsIntro: true,
      recentIntros: ["Old intro"],
      ...overrides,
    });

  it("puts the intro marker, the dated title, a paragraph per person, then the appendix", () => {
    expect(draft().split(`\n\n${APPENDIX_MARKER}`)[0]).toBe(
      `${INTRO_MARKER}\n\n*Daily digest · 2026-09-25*\n\n*alice*\n• did: a\n\n*bob*\n• next: b`,
    );
  });

  it("carries the recent intros in the appendix", () => {
    expect(draft().split(APPENDIX_MARKER)[1]).toContain("- Old intro");
  });

  it("names the voice in the appendix when one is set", () => {
    expect(draft({ voice: "Michael Scott from The Office" })).toContain(
      "Voice: Michael Scott from The Office",
    );
  });

  it("omits the intro marker when no repo asked for a summary", () => {
    expect(draft({ wantsIntro: false })).not.toContain(INTRO_MARKER);
  });

  it("says nothing happened when there are no lines", () => {
    expect(draft({ lines: [] })).toContain(
      "_Nothing merged, closed or planned since the last digest._",
    );
  });
});

describe("stripAppendix", () => {
  it("leaves only the message", () => {
    expect(stripAppendix(`body\n\n${APPENDIX_MARKER}\nold stuff`)).toBe("body");
  });

  it("removes the intro marker a refine never filled", () => {
    expect(stripAppendix(`${INTRO_MARKER}\n\nbody`)).toBe("body");
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

  it("keeps a message ending on a person block as body, not as an ending", () => {
    expect(
      splitDigestMessage(
        "Hello team.\n\n*Daily digest · 2026-10-27*\n\n*alice*\n• did: a (#1)",
      ),
    ).toEqual({
      intro: "Hello team.",
      body: "*Daily digest · 2026-10-27*\n\n*alice*\n• did: a (#1)",
      ending: "",
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

describe("renderChangelogLinks", () => {
  it("links lore and otto to their Changelog tabs on https://lore.example/", () => {
    expect(
      renderChangelogLinks("https://lore.example/", [
        "re-cinq/lore",
        "re-cinq/otto",
      ]),
    ).toBe(
      "Full list: <https://lore.example/repos/re-cinq/lore/changelog|lore> · <https://lore.example/repos/re-cinq/otto/changelog|otto>",
    );
  });

  it("puts the footer in its own paragraph under the people", () => {
    const text = renderDigestDraft({
      header: { weekKey: "2026-W43", date: "2026-10-23" },
      lines: ["*alice*\n• did: a"],
      footer: "Full list: x",
      wantsIntro: false,
      recentIntros: [],
    });

    expect(text.split(`\n\n${APPENDIX_MARKER}`)[0]).toBe(
      "*Daily digest · 2026-10-23*\n\n*alice*\n• did: a\n\nFull list: x",
    );
  });
});
