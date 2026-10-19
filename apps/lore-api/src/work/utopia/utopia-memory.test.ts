import { describe, it, expect } from "vitest";
import type { IngestDocument } from "@re-cinq/lore-shared/utopia/memory-documents.js";
import type { DocumentPushOutcome } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorMemoryBacklog,
  type MemoryKind,
  type MemoryWalkDeps,
  type CursoredDocument,
} from "./utopia-memory.js";

const doc = (cursor: string, external_id: string): CursoredDocument => ({
  cursor,
  document: { external_id, filename: external_id, content: external_id },
});

const E7 = "2026-10-19T09:00:00+00:00|e7";

function walk(setup: {
  cursors: Partial<Record<MemoryKind, string>>;
  rows: Record<MemoryKind, CursoredDocument[]>;
  answers?: Record<string, () => DocumentPushOutcome>;
}) {
  const asked: string[] = [];
  const pushed: string[] = [];
  const cursors: string[] = [];
  const deps: MemoryWalkDeps = {
    base: "re-cinq/lore",
    rows: async (kind, after, limit) => {
      asked.push(`${kind} after ${after ?? "none"} limit ${limit}`);

      return setup.rows[kind];
    },
    cursor: {
      read: async (kind) => setup.cursors[kind] ?? null,
      write: async (kind, cursor) => {
        cursors.push(`${kind}=${cursor}`);
      },
    },
    push: async (kind, document: IngestDocument) => {
      pushed.push(`${kind} ${document.external_id}`);

      return (
        setup.answers?.[document.external_id] ??
        (() => ({ action: "created" as const }))
      )();
    },
  };

  return { deps, asked, pushed, cursors };
}

describe("mirrorMemoryBacklog", () => {
  it("asks for 200 memories after m-41 and 200 episodes from the start, pushes each in order, moves each cursor past every one that landed, and completes the memory pass by setting its cursor back to null", async () => {
    const { deps, asked, pushed, cursors } = walk({
      cursors: { memories: "m-41" },
      rows: {
        memories: [
          doc("m-42", "memory:claude/a"),
          doc("m-45", "memory:claude/b"),
        ],
        episodes: [doc(E7, "episode:e7")],
      },
      answers: {
        "memory:claude/b": () => ({ action: "moved" }),
        "episode:e7": () => ({ action: "duplicate" }),
      },
    });

    expect({
      summary: await mirrorMemoryBacklog(deps),
      asked,
      pushed,
      cursors,
    }).toEqual({
      summary: {
        memories: {
          from: "m-41",
          to: "m-45",
          entries: 2,
          created: 1,
          updated: 1,
          unchanged: 0,
          failed: [],
          pass_complete: true,
        },
        episodes: {
          from: null,
          to: E7,
          entries: 1,
          created: 0,
          updated: 0,
          unchanged: 1,
          failed: [],
        },
      },
      asked: ["memories after m-41 limit 200", "episodes after none limit 200"],
      pushed: [
        "memories memory:claude/a",
        "memories memory:claude/b",
        "episodes episode:e7",
      ],
      cursors: [
        "memories=m-42",
        "memories=m-45",
        "memories=null",
        `episodes=${E7}`,
      ],
    });
  });

  it("leaves the memory pass open at m-200 when the walk read all 200 rows it may", async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      doc(`m-${index + 1}`, `memory:claude/k${index + 1}`),
    );
    const { deps, cursors } = walk({
      cursors: {},
      rows: { memories: full, episodes: [] },
    });

    const { memories } = await mirrorMemoryBacklog(deps);

    expect({
      to: memories.to,
      passComplete: memories.pass_complete,
      last: cursors.at(-1),
    }).toEqual({ to: "m-200", passComplete: false, last: "memories=m-200" });
  });

  it("counts a tombstone of memory:claude/a as landed with no counts, then stops at memory:claude/b whose push threw, leaving the cursor at m-42 and the pass open", async () => {
    const { deps, pushed, cursors } = walk({
      cursors: {},
      rows: {
        memories: [
          doc("m-42", "memory:claude/a"),
          doc("m-45", "memory:claude/b"),
          doc("m-46", "memory:claude/c"),
        ],
        episodes: [],
      },
      answers: {
        "memory:claude/a": () => ({ action: "marked_missing" }),
        "memory:claude/b": () => {
          throw new Error("utopia answered 503: busy");
        },
      },
    });

    const { memories } = await mirrorMemoryBacklog(deps);

    expect({ memories, pushed, cursors }).toEqual({
      memories: {
        from: null,
        to: "m-42",
        entries: 1,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: ["memory:claude/b: utopia answered 503: busy"],
        pass_complete: false,
      },
      pushed: ["memories memory:claude/a", "memories memory:claude/b"],
      cursors: ["memories=m-42"],
    });
  });
});
