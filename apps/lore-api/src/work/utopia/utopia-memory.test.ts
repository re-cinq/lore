import { describe, it, expect } from "vitest";
import type { IngestDocument } from "@re-cinq/lore-shared/utopia/memory-documents.js";
import type { DocumentPushOutcome } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorMemoryBacklog,
  type MemoryKind,
  type MemoryWalkDeps,
  type SequencedDocument,
} from "./utopia-memory.js";

const doc = (seq: string, external_id: string): SequencedDocument => ({
  seq,
  document: { external_id, filename: external_id, content: external_id },
});

function walk(setup: {
  cursors: Partial<Record<MemoryKind, string>>;
  rows: Record<MemoryKind, SequencedDocument[]>;
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
      write: async (kind, seq) => {
        cursors.push(`${kind}=${seq}`);
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
  it("asks for 200 memories above cursor 41 and 200 episodes from the start, pushes each in sequence order, moves each cursor past every one that landed and answers both walks", async () => {
    const { deps, asked, pushed, cursors } = walk({
      cursors: { memories: "41" },
      rows: {
        memories: [doc("42", "memory:claude/a"), doc("45", "memory:claude/b")],
        episodes: [doc("7", "episode:e7")],
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
          from: "41",
          to: "45",
          entries: 2,
          created: 1,
          updated: 1,
          unchanged: 0,
          failed: [],
        },
        episodes: {
          from: null,
          to: "7",
          entries: 1,
          created: 0,
          updated: 0,
          unchanged: 1,
          failed: [],
        },
      },
      asked: ["memories after 41 limit 200", "episodes after none limit 200"],
      pushed: [
        "memories memory:claude/a",
        "memories memory:claude/b",
        "episodes episode:e7",
      ],
      cursors: ["memories=42", "memories=45", "episodes=7"],
    });
  });

  it("counts a tombstone of memory:claude/a as landed with no counts, then stops at memory:claude/b whose push threw, leaving the cursor at 42", async () => {
    const { deps, pushed, cursors } = walk({
      cursors: {},
      rows: {
        memories: [
          doc("42", "memory:claude/a"),
          doc("45", "memory:claude/b"),
          doc("46", "memory:claude/c"),
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
        to: "42",
        entries: 1,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: ["memory:claude/b: utopia answered 503: busy"],
      },
      pushed: ["memories memory:claude/a", "memories memory:claude/b"],
      cursors: ["memories=42"],
    });
  });
});
