import { describe, it, expect } from "vitest";
import { enforceTrue } from "../../../lib/enforce.js";
import {
  mirrorDocument,
  unmirrorDocument,
  type DocMirrorDeps,
} from "./mirror-document.js";
import type { IngestDocument } from "../../../domain/utopia/memory/memory-documents.js";
import type { PushItem } from "../../../domain/utopia/statements.js";
import type { DocumentMirrorDeps } from "../push-items.js";
import type {
  DocumentPushOutcome,
  PushAction,
} from "../../../outbound/utopia/utopia-client.js";

const SPEC = [
  "## Chain",
  "",
  "- FR1 — Pushed. ([validated by pushes](src/a.test.ts#L3))",
  "- FR2 — Counted.",
  "",
].join("\n");

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const textRecorder = (answer: DocumentPushOutcome["action"] = "created") => {
  const pushed: IngestDocument[] = [];

  return {
    pushed,
    deps: {
      push: async (document: IngestDocument) => {
        pushed.push(document);

        return { action: answer };
      },
    },
  };
};

const statementRecorder = (answer: (pushed: PushItem) => PushAction) => {
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

const targetsOf = (
  text: DocumentMirrorDeps,
  statements: DocMirrorDeps,
  previous: Record<string, string[]> = {},
) => {
  const recorded: Record<string, string[]> = {};
  const swept: number[] = [];

  return {
    recorded,
    swept,
    targets: {
      text,
      statements,
      ledger: {
        pushedFor: async (path: string) => previous[path] ?? [],
        record: async (path: string, externalIds: string[]) => {
          recorded[path] = externalIds;
        },
      },
      sweepMissing: async () => {
        swept.push(swept.length + 1);
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
  it("pushes doc:specs/mirror/spec.md whole to the text source and one stmt item per statement to the statements source, counting created, updated and unchanged", async () => {
    const answers: Record<string, PushAction> = {
      "stmt:specs/mirror/spec.md#0000": "updated",
      "stmt:specs/mirror/spec.md#0001": "unchanged",
    };
    const text = textRecorder("created");
    const statements = statementRecorder(
      (candidate) => answers[candidate.externalId],
    );
    const outcome = await mirrorDocument(
      targetsOf(text.deps, statements.deps).targets,
      input,
    );

    expect({
      outcome,
      text: text.pushed.map((document) => document.external_id),
      statements: statements.pushed.map((candidate) => candidate.externalId),
    }).toEqual({
      outcome: { items: 3, created: 1, updated: 1, unchanged: 1, failed: [] },
      text: ["doc:specs/mirror/spec.md"],
      statements: [
        "stmt:specs/mirror/spec.md#0000",
        "stmt:specs/mirror/spec.md#0001",
      ],
    });
  });

  it("names a statement item whose push threw under failed, still pushes the others and the text", async () => {
    const text = textRecorder();
    const statements = statementRecorder(() => "created");
    const failing = {
      push: async (candidate: PushItem) => {
        enforceTrue(
          !candidate.externalId.endsWith("#0000"),
          Error,
          "utopia answered 422: bad entity",
        );

        return statements.deps.push(candidate);
      },
    };
    const outcome = await mirrorDocument(
      targetsOf(text.deps, failing).targets,
      input,
    );

    expect({ outcome, pushed: statements.pushed.length }).toEqual({
      outcome: {
        items: 3,
        created: 2,
        updated: 0,
        unchanged: 0,
        failed: [
          "stmt:specs/mirror/spec.md#0000: utopia answered 422: bad entity",
        ],
      },
      pushed: 1,
    });
  });

  it("names doc:specs/mirror/spec.md under failed when Utopia answers duplicate for the text", async () => {
    const outcome = await mirrorDocument(
      targetsOf(
        textRecorder("duplicate").deps,
        statementRecorder(() => "created").deps,
      ).targets,
      input,
    );

    expect(outcome.failed).toEqual([
      "doc:specs/mirror/spec.md: duplicate, another document in the knowledge base holds the same content",
    ]);
  });
});

describe("mirrorDocument test titles", () => {
  it("reads src/a.test.ts and src/gone.test.ts at the commit and names the a.test.ts:3 link by its it title, linking nothing for the file that is gone", async () => {
    const statements = statementRecorder(() => "created");
    const reads: string[] = [];
    const readTest = async (path: string, commit: string) => {
      reads.push(`${path}@${commit}`);

      return path === "src/a.test.ts"
        ? 'describe("mirror", () => {\n  it("pushes the doc item", () => {});\n});'
        : null;
    };

    await mirrorDocument(
      targetsOf(textRecorder().deps, { ...statements.deps, readTest }).targets,
      {
        ...input,
        content:
          "## Chain\n\n- FR1 — Pushed. ([validated by `a.test.ts:3`](src/a.test.ts#L2), [`gone.test.ts:1`](src/gone.test.ts#L1))\n",
      },
    );

    expect({ reads, statement: statements.pushed[0] }).toMatchObject({
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

describe("mirrorDocument removed statements", () => {
  const PREVIOUS = {
    "specs/mirror/spec.md": [
      "stmt:specs/mirror/spec.md#0000",
      "stmt:specs/mirror/spec.md#0001",
      "stmt:specs/mirror/spec.md#0002",
      "stmt:specs/mirror/spec.md#0002.2",
    ],
  };

  it("tombstones #0002 and #0002.2, last pushed but gone from the spec, sweeps once and records #0000 and #0001", async () => {
    const statements = statementRecorder(() => "unchanged");
    const mirror = targetsOf(textRecorder().deps, statements.deps, PREVIOUS);

    await mirrorDocument(mirror.targets, input);

    expect({
      tombstoned: statements.pushed.filter((pushed) => "deleted" in pushed),
      swept: mirror.swept,
      recorded: mirror.recorded,
    }).toEqual({
      tombstoned: [
        { externalId: "stmt:specs/mirror/spec.md#0002", deleted: true },
        { externalId: "stmt:specs/mirror/spec.md#0002.2", deleted: true },
      ],
      swept: [1],
      recorded: {
        "specs/mirror/spec.md": [
          "stmt:specs/mirror/spec.md#0000",
          "stmt:specs/mirror/spec.md#0001",
        ],
      },
    });
  });

  it("records the pushed ids without sweeping when no statement was removed", async () => {
    const mirror = targetsOf(
      textRecorder().deps,
      statementRecorder(() => "created").deps,
    );

    await mirrorDocument(mirror.targets, input);

    expect({ swept: mirror.swept, recorded: mirror.recorded }).toEqual({
      swept: [],
      recorded: {
        "specs/mirror/spec.md": [
          "stmt:specs/mirror/spec.md#0000",
          "stmt:specs/mirror/spec.md#0001",
        ],
      },
    });
  });

  it("neither sweeps nor records when the #0002 tombstone fails, so the next push sends it again", async () => {
    const failing = {
      push: async (candidate: PushItem) => {
        enforceTrue(
          !candidate.externalId.endsWith("#0002"),
          Error,
          "utopia answered 503: busy",
        );

        return { action: "unchanged" as const };
      },
    };
    const mirror = targetsOf(textRecorder().deps, failing, PREVIOUS);

    await mirrorDocument(mirror.targets, input);

    expect({ swept: mirror.swept, recorded: mirror.recorded }).toEqual({
      swept: [],
      recorded: {},
    });
  });
});

describe("unmirrorDocument", () => {
  it("tombstones doc:adrs/ADR-1.md and its last pushed stmt:adrs/ADR-1.md#0000, sweeps and records nothing for the path", async () => {
    const text = textRecorder("marked_missing");
    const statements = statementRecorder(() => "marked_missing");
    const mirror = targetsOf(text.deps, statements.deps, {
      "adrs/ADR-1.md": ["stmt:adrs/ADR-1.md#0000"],
    });
    const outcome = await unmirrorDocument(mirror.targets, "adrs/ADR-1.md");

    expect({
      outcome,
      text: text.pushed,
      statements: statements.pushed,
      swept: mirror.swept,
      recorded: mirror.recorded,
    }).toEqual({
      outcome: { items: 2, created: 0, updated: 0, unchanged: 0, failed: [] },
      text: [
        {
          external_id: "doc:adrs/ADR-1.md",
          filename: "adrs/ADR-1.md",
          deleted: true,
        },
      ],
      statements: [{ externalId: "stmt:adrs/ADR-1.md#0000", deleted: true }],
      swept: [1],
      recorded: { "adrs/ADR-1.md": [] },
    });
  });
});
