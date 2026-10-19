import { describe, it, expect } from "vitest";
import { enforceTrue } from "../../lib/enforce.js";
import { mirrorDocument, tombstoneDocument } from "./mirror-document.js";
import type { PushItem } from "../../domain/utopia/statements.js";
import type { PushAction } from "../../outbound/utopia/utopia-client.js";

const SPEC = [
  "## Chain",
  "",
  "- FR1 — Pushed. ([validated by pushes](src/a.test.ts#L3))",
  "- FR2 — Counted.",
  "",
].join("\n");

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const recorder = (answer: (pushed: PushItem) => PushAction) => {
  const pushed: PushItem[] = [];

  return {
    pushed,
    deps: {
      push: async (candidate: PushItem) => {
        pushed.push(candidate);

        return { action: answer(candidate) };
      },
    },
  };
};

const input = {
  repo: "re-cinq/lore",
  path: "specs/mirror/spec.md",
  content: SPEC,
  commit: COMMIT,
  kind: "spec" as const,
};

describe("mirrorDocument", () => {
  it("pushes the doc item and one item per statement and counts created, updated and unchanged", async () => {
    const answers: Record<string, PushAction> = {
      "doc:specs/mirror/spec.md": "created",
      "stmt:specs/mirror/spec.md#0000": "updated",
      "stmt:specs/mirror/spec.md#0001": "unchanged",
    };
    const { pushed, deps } = recorder(
      (candidate) => answers[candidate.externalId],
    );
    const outcome = await mirrorDocument(deps, input);

    expect({
      outcome,
      ids: pushed.map((candidate) => candidate.externalId),
    }).toEqual({
      outcome: { items: 3, created: 1, updated: 1, unchanged: 1, failed: [] },
      ids: [
        "doc:specs/mirror/spec.md",
        "stmt:specs/mirror/spec.md#0000",
        "stmt:specs/mirror/spec.md#0001",
      ],
    });
  });

  it("names a statement item whose push threw under failed and still pushes the others", async () => {
    const { pushed, deps } = recorder(() => "created");
    const failing = {
      push: async (candidate: PushItem) => {
        enforceTrue(
          !candidate.externalId.endsWith("#0000"),
          Error,
          "utopia answered 422: bad entity",
        );

        return deps.push(candidate);
      },
    };
    const outcome = await mirrorDocument(failing, input);

    expect({ outcome, pushed: pushed.length }).toEqual({
      outcome: {
        items: 3,
        created: 2,
        updated: 0,
        unchanged: 0,
        failed: [
          "stmt:specs/mirror/spec.md#0000: utopia answered 422: bad entity",
        ],
      },
      pushed: 2,
    });
  });
});

describe("mirrorDocument test titles", () => {
  it("reads src/a.test.ts and src/gone.test.ts at the commit and names the a.test.ts:3 link by its it title, linking nothing for the file that is gone", async () => {
    const { pushed, deps } = recorder(() => "created");
    const reads: string[] = [];
    const readTest = async (path: string, commit: string) => {
      reads.push(`${path}@${commit}`);

      return path === "src/a.test.ts"
        ? 'describe("mirror", () => {\n  it("pushes the doc item", () => {});\n});'
        : null;
    };

    await mirrorDocument(
      { ...deps, readTest },
      {
        ...input,
        content:
          "## Chain\n\n- FR1 — Pushed. ([validated by `a.test.ts:3`](src/a.test.ts#L2), [`gone.test.ts:1`](src/gone.test.ts#L1))\n",
      },
    );

    expect({ reads, statement: pushed[1] }).toMatchObject({
      reads: [`src/a.test.ts@${COMMIT}`, `src/gone.test.ts@${COMMIT}`],
      statement: {
        e: [
          ["re-cinq/lore:specs/mirror/spec.md#chain", "Section", true],
          ["re-cinq/lore:specs/mirror/spec.md#s0000", "Statement", true],
          ["re-cinq/lore:src/a.test.ts::pushes the doc item", "Test", true],
        ],
      },
    });
  });
});

describe("tombstoneDocument", () => {
  it("tombstones the doc item and the statement items of the ordinals it is given", async () => {
    const { pushed, deps } = recorder(() => "marked_missing");
    const outcome = await tombstoneDocument(deps, {
      repo: "re-cinq/lore",
      path: "specs/mirror/spec.md",
      ordinals: [0, 1],
    });

    expect({ outcome, pushed }).toEqual({
      outcome: { items: 3, created: 0, updated: 0, unchanged: 0, failed: [] },
      pushed: [
        { externalId: "doc:specs/mirror/spec.md", deleted: true },
        { externalId: "stmt:specs/mirror/spec.md#0000", deleted: true },
        { externalId: "stmt:specs/mirror/spec.md#0001", deleted: true },
      ],
    });
  });

  it("tombstones only the doc item when no ordinals are known", async () => {
    const { pushed, deps } = recorder(() => "marked_missing");

    await tombstoneDocument(deps, {
      repo: "re-cinq/lore",
      path: "adrs/ADR-1.md",
    });

    expect(pushed).toEqual([
      { externalId: "doc:adrs/ADR-1.md", deleted: true },
    ]);
  });
});
