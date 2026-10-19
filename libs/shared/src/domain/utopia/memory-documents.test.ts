import { describe, it, expect } from "vitest";
import {
  episodeDocument,
  memoryDocument,
  type MirroredMemory,
} from "./memory-documents.js";

const memory: MirroredMemory = {
  agentId: "claude-bogdan",
  key: "deployment-gotchas-2026-10-19",
  value: "GKE egress policies must open node-local-dns.",
  createdAt: "2026-10-19T08:30:00.123456+00:00",
  live: true,
};

describe("memoryDocument", () => {
  it("returns memory:claude-bogdan/deployment-gotchas-2026-10-19 named after its key, with the key above the value and its write time", () => {
    expect(memoryDocument(memory)).toEqual({
      external_id: "memory:claude-bogdan/deployment-gotchas-2026-10-19",
      filename: "deployment-gotchas-2026-10-19",
      content:
        "deployment-gotchas-2026-10-19\n\nGKE egress policies must open node-local-dns.",
      doc_time: "2026-10-19T08:30:00.123456+00:00",
    });
  });

  it("returns a tombstone of memory:claude-bogdan/deployment-gotchas-2026-10-19 with no content when the memory is deleted or expired", () => {
    expect(memoryDocument({ ...memory, live: false })).toEqual({
      external_id: "memory:claude-bogdan/deployment-gotchas-2026-10-19",
      filename: "deployment-gotchas-2026-10-19",
      deleted: true,
    });
  });
});

describe("episodeDocument", () => {
  it("returns episode:4f1c named episode-4f1c with the stored content and its insert time", () => {
    expect(
      episodeDocument({
        id: "4f1c",
        content: "Session in re-cinq/lore\n\nMoved the tracker cursor.",
        createdAt: "2026-10-19T09:00:00+00:00",
      }),
    ).toEqual({
      external_id: "episode:4f1c",
      filename: "episode-4f1c",
      content: "Session in re-cinq/lore\n\nMoved the tracker cursor.",
      doc_time: "2026-10-19T09:00:00+00:00",
    });
  });
});
