import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { assembleHandle, type AssembleDeps } from "./station.js";

const SPEC_PATH = "specs/widget/spec.md";
const SPEC =
  "# Widget\n\nIntro.\n\n## Requirements\n\n- Existing rule.\n\n## Risks\n\n- Old risk.\n";

const patch = (section: string, ops: unknown[], extra: object = {}) => ({
  section,
  status: "integrated",
  technical_additions: [{ claim: "Uses lore.refunds.", source: "db.sql#L1" }],
  ops,
  ...extra,
});
const scope = patch("scope", [
  { op: "append", heading: "## Requirements", text: "- Refunds exist." },
]);
const risk = patch(
  "risk",
  [{ op: "append", heading: "## Risks", text: "- Rates may lag." }],
  { technical_additions: [] },
);
const STATE = {
  handed: ["scope", "risk"],
  done: [],
  failed: [],
  attempts: {},
  redo: [],
  redoRound: 0,
};

function scene(
  patches: unknown[],
  state: object = STATE,
  specPlanPath = SPEC_PATH,
) {
  const produced: Record<string, string> = {};
  const committed: Array<{ path: string; text: string; message: string }> = [];
  const files: Record<string, string> = {
    spec_plan: JSON.stringify({ creates: [{ path: specPlanPath }] }),
    section_state: JSON.stringify(state),
  };
  const tools: Tools = {
    read: async (need) => Buffer.from(files[need] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const deps: AssembleDeps = {
    readSpec: async (_repo, path) => (path === SPEC_PATH ? SPEC : null),
    commitSpec: async (_repo, _branch, { path, text }, message) => {
      committed.push({ path, text, message });
    },
  };

  return {
    handle: assembleHandle(deps),
    tools,
    produced,
    committed,
    brief: {
      visitId: "visit-assemble",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/lore@spec/widget",
        spec_plan: "blob://s",
        section_state: "blob://st",
        section_patches: JSON.stringify(
          patches.map((one) => JSON.stringify(one)),
        ),
      },
    },
  };
}

const stateOf = (produced: Record<string, string>) =>
  JSON.parse(produced.section_state ?? "null");

describe("assembleHandle", () => {
  it("applies the patches in the order the sections were handed and commits the spec once", async () => {
    const { handle, tools, brief, committed } = scene([scope, risk]);

    const report = await handle(brief, tools);

    expect({
      report,
      commits: committed.length,
      text: committed[0]?.text,
    }).toEqual({
      report: { outcome: "success" },
      commits: 1,
      text: "# Widget\n\nIntro.\n\n## Requirements\n\n- Existing rule.\n\n- Refunds exist.\n\n## Risks\n\n- Old risk.\n\n- Rates may lag.\n",
    });
  });

  it("names the sections it folded in the commit message", async () => {
    const { handle, tools, brief, committed } = scene([scope, risk]);

    await handle(brief, tools);

    expect(committed[0]).toMatchObject({
      path: SPEC_PATH,
      message: "Fold plan sections into the spec: scope, risk",
    });
  });

  it("leaves a section that found nothing relevant out of the commit message", async () => {
    const quiet = patch("risk", [], { status: "nothing_relevant" });
    const { handle, tools, brief, committed } = scene([scope, quiet]);

    await handle(brief, tools);

    expect(committed[0]?.message).toBe(
      "Fold plan sections into the spec: scope",
    );
  });

  it("marks the settled sections done and clears what was handed", async () => {
    const { handle, tools, brief, produced } = scene([scope, risk]);

    await handle(brief, tools);

    expect(stateOf(produced)).toMatchObject({
      handed: [],
      done: ["scope", "risk"],
    });
  });

  it("matches each patch to its section whatever order the pods finished in", async () => {
    const { handle, tools, brief, committed } = scene([risk, scope]);

    await handle(brief, tools);

    expect(committed[0]!.text.indexOf("Refunds exist")).toBeLessThan(
      committed[0]!.text.indexOf("Rates may lag"),
    );
  });

  it("asks for another round when a section's pod returned nothing, and still folds in the others", async () => {
    const { handle, tools, brief, committed, produced } = scene([scope]);

    const report = await handle(brief, tools);

    expect({
      report,
      folded: committed[0]?.text.includes("Refunds exist"),
      attempts: stateOf(produced).attempts,
    }).toEqual({
      report: { outcome: "retry" },
      folded: true,
      attempts: { risk: 1 },
    });
  });

  it("asks for another round when an operation of a patch could not be applied", async () => {
    const broken = patch("risk", [
      { op: "amend", find: "Nowhere.", replace: "x" },
    ]);
    const { handle, tools, brief, produced } = scene([scope, broken]);

    const report = await handle(brief, tools);

    expect({ report, done: stateOf(produced).done }).toEqual({
      report: { outcome: "retry" },
      done: ["scope"],
    });
  });

  it("treats a patch that is not valid JSON as no patch", async () => {
    const { handle, tools, brief, produced } = scene([scope]);
    const garbled = {
      ...brief,
      needs: {
        ...brief.needs,
        section_patches: JSON.stringify([JSON.stringify(scope), "{not json"]),
      },
    };

    await handle(garbled, tools);

    expect(stateOf(produced).attempts).toEqual({ risk: 1 });
  });

  it("gives up on a section after its attempts and goes on", async () => {
    const { handle, tools, brief, produced } = scene([scope], {
      ...STATE,
      attempts: { risk: 1 },
    });

    const report = await handle(brief, tools);

    expect({ report, failed: stateOf(produced).failed }).toEqual({
      report: { outcome: "success" },
      failed: ["risk"],
    });
  });

  it("commits nothing when no section was handed out", async () => {
    const { handle, tools, brief, committed } = scene([], {
      ...STATE,
      handed: [],
    });

    const report = await handle(brief, tools);

    expect({ report, commits: committed.length }).toEqual({
      report: { outcome: "success" },
      commits: 0,
    });
  });

  it("folds the patches into specs/widget/spec.md when the spec plan names the folder specs/widget/", async () => {
    const { handle, tools, brief, committed, produced } = scene(
      [scope, risk],
      STATE,
      "specs/widget/",
    );

    const report = await handle(brief, tools);

    expect({
      report,
      committed: committed.map((commit) => commit.path),
      done: stateOf(produced).done,
    }).toEqual({
      report: { outcome: "success" },
      committed: [SPEC_PATH],
      done: ["scope", "risk"],
    });
  });
});
