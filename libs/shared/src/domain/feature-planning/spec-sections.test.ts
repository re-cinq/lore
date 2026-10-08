import { describe, expect, it } from "vitest";
import type { CitablePlan } from "./plan-coverage.js";
import {
  INTEGRATED_SLOTS,
  MAX_SECTION_ATTEMPTS,
  TECHNICAL_SLOTS,
  alignPatches,
  applyPatches,
  emptySectionState,
  sectionPatchSchema,
  settleRound,
  startRound,
  type SectionPatch,
  type SectionState,
} from "./spec-sections.js";

const block = (id: string, slot: string, text: string) => ({
  id,
  slot,
  kind: "paragraph",
  text,
  link: `https://lore.example/plans/p1#${id}`,
});

const PLAN: CitablePlan = {
  plan_url: "https://lore.example/plans/p1",
  blocks: [
    block("b1", "intent", "Pay in your currency."),
    block("b2", "risk", "Rates may lag."),
    block("b3", "scope", "Billing is out."),
    block("b4", "scope", "Refunds are in."),
  ],
};

const state = (patch: Partial<SectionState> = {}): SectionState => ({
  ...emptySectionState(),
  ...patch,
});

const patch = (overrides: Partial<SectionPatch> = {}): SectionPatch => ({
  section: "scope",
  status: "integrated",
  technical_additions: [
    { claim: "Refunds use lore.refunds.", source: "db/0001.sql#L4" },
  ],
  ops: [{ op: "append", heading: "## Requirements", text: "- Refunds exist." }],
  ...overrides,
});

describe("sectionPatchSchema", () => {
  it("accepts a patch with append and amend operations and defaults the rest to none", () => {
    expect(
      sectionPatchSchema.parse({
        section: "risk",
        status: "nothing_relevant",
        ops: [{ op: "amend", find: "old", replace: "new" }],
      }),
    ).toEqual({
      section: "risk",
      status: "nothing_relevant",
      technical_additions: [],
      ops: [{ op: "amend", find: "old", replace: "new" }],
    });
  });

  it("rejects an amend that has nothing to find", () => {
    expect(() =>
      sectionPatchSchema.parse({
        section: "risk",
        status: "integrated",
        ops: [{ op: "amend", find: "", replace: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an operation that is neither append nor amend", () => {
    expect(() =>
      sectionPatchSchema.parse({
        section: "risk",
        status: "integrated",
        ops: [{ op: "delete", find: "x" }],
      }),
    ).toThrow();
  });
});

describe("startRound", () => {
  it("hands every section with blocks at once, in line order, leaving intent to the draft", () => {
    const round = startRound(PLAN, state(), null);

    expect({
      slots: round.items.map(
        (entry) => (JSON.parse(entry) as { slot: string }).slot,
      ),
      handed: round.state.handed,
    }).toEqual({ slots: ["scope", "risk"], handed: ["scope", "risk"] });
  });

  it("gives each entry its slot and the section text with the technical rule", () => {
    const [scope, risk] = startRound(PLAN, state(), null).items.map(
      (entry) => JSON.parse(entry) as { slot: string; text: string },
    );

    expect([scope!.text, risk!.text]).toEqual([
      "## scope\n\nTechnical additions: required.\n\n- Billing is out. ([plan](https://lore.example/plans/p1#b3))\n- Refunds are in. ([plan](https://lore.example/plans/p1#b4))\n",
      "## risk\n\nTechnical additions: none; add no filler.\n\n- Rates may lag. ([plan](https://lore.example/plans/p1#b2))\n",
    ]);
  });

  it("leaves out a section that is done or failed", () => {
    const round = startRound(
      PLAN,
      state({ done: ["scope"], failed: ["risk"] }),
      null,
    );

    expect(round.items).toEqual([]);
  });

  it("hands only the sections the gate sent back once its round is newer", () => {
    const round = startRound(PLAN, state({ done: ["scope", "risk"] }), {
      round: 1,
      sections: ["risk"],
    });

    expect({
      slots: round.state.handed,
      redo: round.state.redo,
      redoRound: round.state.redoRound,
    }).toEqual({
      slots: ["risk"],
      redo: ["risk"],
      redoRound: 1,
    });
  });

  it("ignores a redo request it has already taken", () => {
    const taken = state({ done: ["scope", "risk"], redoRound: 2 });

    expect(
      startRound(PLAN, taken, { round: 2, sections: ["scope"] }).items,
    ).toEqual([]);
  });

  it("hands the repair visit, with no plan section, for gaps no question maps to", () => {
    const [entry] = startRound(PLAN, state({ done: ["scope", "risk"] }), {
      round: 1,
      sections: ["*"],
    }).items;

    expect(JSON.parse(entry!)).toEqual({
      slot: "*",
      text: "## repair\n\nFix what plan-coverage.md and qa-failures.md list; no plan section is attached to this visit.\n",
    });
  });

  it("gives a failed section its attempts again when the gate sends it back", () => {
    const round = startRound(
      PLAN,
      state({ failed: ["risk"], attempts: { risk: 1 }, done: ["scope"] }),
      { round: 1, sections: ["risk"] },
    );

    expect({
      failed: round.state.failed,
      attempts: round.state.attempts,
    }).toEqual({ failed: [], attempts: {} });
  });

  it("orders sections by line order, not by block order", () => {
    expect(INTEGRATED_SLOTS.indexOf("scope")).toBeLessThan(
      INTEGRATED_SLOTS.indexOf("risk"),
    );
  });

  it("requires technical additions for scope, constraints and delivery only", () => {
    expect(TECHNICAL_SLOTS).toEqual(["scope", "constraints", "delivery"]);
  });
});

describe("settleRound", () => {
  const handed = (...slots: string[]) => state({ handed: slots });

  it("marks a section done when its pod integrated it with technical additions", () => {
    const settled = settleRound(handed("scope"), [patch()], {});

    expect({ done: settled.state.done, retry: settled.retry }).toEqual({
      done: ["scope"],
      retry: false,
    });
  });

  it("marks a non-technical section done on integrated with no additions", () => {
    const settled = settleRound(
      handed("risk"),
      [patch({ section: "risk", technical_additions: [] })],
      {},
    );

    expect(settled.state.done).toEqual(["risk"]);
  });

  it("marks a technical section done when the pod says nothing in it was relevant", () => {
    const settled = settleRound(
      handed("scope"),
      [patch({ status: "nothing_relevant", technical_additions: [], ops: [] })],
      {},
    );

    expect(settled.state.done).toEqual(["scope"]);
  });

  it("retries a technical section integrated with no additions", () => {
    const settled = settleRound(
      handed("scope"),
      [patch({ technical_additions: [] })],
      {},
    );

    expect({
      done: settled.state.done,
      attempts: settled.state.attempts,
      retry: settled.retry,
    }).toEqual({
      done: [],
      attempts: { scope: 1 },
      retry: true,
    });
  });

  it("retries a section whose pod returned no patch", () => {
    const settled = settleRound(handed("scope"), [null], {});

    expect({ attempts: settled.state.attempts, retry: settled.retry }).toEqual({
      attempts: { scope: 1 },
      retry: true,
    });
  });

  it("retries a section whose patch is for another section", () => {
    const settled = settleRound(
      handed("scope"),
      [patch({ section: "risk" })],
      {},
    );

    expect(settled.state.attempts).toEqual({ scope: 1 });
  });

  it("retries a section some of whose operations could not be applied", () => {
    const settled = settleRound(handed("scope"), [patch()], { scope: 1 });

    expect({
      done: settled.state.done,
      attempts: settled.state.attempts,
    }).toEqual({ done: [], attempts: { scope: 1 } });
  });

  it("records the section as failed once its attempts are spent", () => {
    const settled = settleRound(
      state({
        handed: ["scope"],
        attempts: { scope: MAX_SECTION_ATTEMPTS - 1 },
      }),
      [patch({ status: "failed" })],
      {},
    );

    expect({ failed: settled.state.failed, retry: settled.retry }).toEqual({
      failed: ["scope"],
      retry: false,
    });
  });

  it("settles each handed section on its own patch, in the order they were handed", () => {
    const settled = settleRound(
      handed("scope", "risk"),
      [patch(), patch({ section: "risk", status: "failed" })],
      {},
    );

    expect({
      done: settled.state.done,
      attempts: settled.state.attempts,
    }).toEqual({
      done: ["scope"],
      attempts: { risk: 1 },
    });
  });

  it("takes a redone section out of the redo list, and accepts it without new technical facts", () => {
    const settled = settleRound(
      state({ handed: ["scope"], done: ["scope"], redo: ["scope", "risk"] }),
      [patch({ technical_additions: [] })],
      {},
    );

    expect({ redo: settled.state.redo, done: settled.state.done }).toEqual({
      redo: ["risk"],
      done: ["scope"],
    });
  });

  it("clears what was handed out", () => {
    expect(settleRound(handed("scope"), [patch()], {}).state.handed).toEqual(
      [],
    );
  });
});

describe("alignPatches", () => {
  it("puts each patch at the position of the section it is for, and none where a pod returned nothing", () => {
    const risk = patch({ section: "risk" });
    const scope = patch();

    expect(alignPatches(["scope", "kpis", "risk"], [risk, scope])).toEqual([
      scope,
      null,
      risk,
    ]);
  });

  it("takes the first of two patches for one section", () => {
    const first = patch();
    const second = patch({ status: "failed" });

    expect(alignPatches(["scope"], [first, second])).toEqual([first]);
  });
});

describe("applyPatches", () => {
  const SPEC =
    "# Widget\n\nIntro.\n\n## Requirements\n\n- Existing rule.\n\n## Risks\n\n- Old risk.\n";

  it("appends text at the end of the named heading's body", () => {
    const applied = applyPatches({ "spec.md": SPEC }, [patch()], "spec.md");

    expect(applied.files["spec.md"]).toBe(
      "# Widget\n\nIntro.\n\n## Requirements\n\n- Existing rule.\n\n- Refunds exist.\n\n## Risks\n\n- Old risk.\n",
    );
  });

  it("adds a heading the spec lacks at the end", () => {
    const applied = applyPatches(
      { "spec.md": SPEC },
      [
        patch({
          ops: [{ op: "append", heading: "## Constraints", text: "- Fits." }],
        }),
      ],
      "spec.md",
    );

    expect(
      applied.files["spec.md"]!.endsWith("\n## Constraints\n\n- Fits.\n"),
    ).toBe(true);
  });

  it("amends the one place a statement stands", () => {
    const applied = applyPatches(
      { "spec.md": SPEC },
      [
        patch({
          ops: [
            {
              op: "amend",
              find: "Existing rule.",
              replace: "Existing rule, amended.",
            },
          ],
        }),
      ],
      "spec.md",
    );

    expect(applied.files["spec.md"]).toContain("- Existing rule, amended.");
  });

  it("counts an amend whose text is missing or stands twice as failed, per section, and changes nothing for it", () => {
    const applied = applyPatches(
      { "spec.md": `${SPEC}\n- Existing rule.\n` },
      [
        patch({ ops: [{ op: "amend", find: "Existing rule.", replace: "x" }] }),
        patch({
          section: "risk",
          ops: [{ op: "amend", find: "Nowhere.", replace: "y" }],
        }),
      ],
      "spec.md",
    );

    expect({
      failed: applied.failedOps,
      same: applied.files["spec.md"] === `${SPEC}\n- Existing rule.\n`,
    }).toEqual({
      failed: { scope: 1, risk: 1 },
      same: true,
    });
  });

  it("lets a later patch amend what an earlier one appended, and counts a second amend of the same text as failed", () => {
    const applied = applyPatches(
      { "spec.md": SPEC },
      [
        patch({
          ops: [{ op: "amend", find: "Old risk.", replace: "New risk." }],
        }),
        patch({
          section: "risk",
          ops: [{ op: "amend", find: "Old risk.", replace: "Other risk." }],
        }),
      ],
      "spec.md",
    );

    expect({
      text: applied.files["spec.md"]!.includes("New risk."),
      failed: applied.failedOps,
    }).toEqual({
      text: true,
      failed: { scope: 0, risk: 1 },
    });
  });

  it("writes an operation to the file it names, and to the default file when it names none", () => {
    const applied = applyPatches(
      { "a.md": "# A\n", "b.md": "# B\n" },
      [
        patch({
          ops: [
            {
              op: "append",
              file: "b.md",
              heading: "## Requirements",
              text: "- In b.",
            },
            { op: "append", heading: "## Requirements", text: "- In a." },
          ],
        }),
      ],
      "a.md",
    );

    expect([
      applied.files["a.md"]!.includes("- In a."),
      applied.files["b.md"]!.includes("- In b."),
    ]).toEqual([true, true]);
  });

  it("counts an operation for a file the plan does not name as failed, and creates nothing", () => {
    const applied = applyPatches(
      { "spec.md": "# A\n" },
      [
        patch({
          ops: [
            { op: "append", file: "other.md", heading: "## X", text: "- y" },
          ],
        }),
      ],
      "spec.md",
    );

    expect({
      failed: applied.failedOps,
      files: Object.keys(applied.files),
    }).toEqual({
      failed: { scope: 1 },
      files: ["spec.md"],
    });
  });
});
