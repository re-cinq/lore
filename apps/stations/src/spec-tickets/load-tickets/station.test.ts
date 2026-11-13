import type { Tools } from "@re-cinq/floor-station";
import { valueItem } from "@re-cinq/lore-shared/floor/floor-items.js";
import { describe, expect, it, vi } from "vitest";
import { loadTicketsHandle } from "./station.js";

const SPEC_PATH = "specs/widget/spec.md";
const TEST_PATH = "src/widget.test.ts";
const BEFORE =
  "# Widget\nAn interface.\n## Requirements\n\n- The widget MUST render messages.\n- The widget MUST accept a colour prop.\n";
const NOW = BEFORE.replace(
  "render messages.",
  `render messages. ([validated by renders messages](../../${TEST_PATH}#L1))`,
);
const FILES: Record<string, Record<string, string>> = {
  c1: { [SPEC_PATH]: BEFORE },
  c2: { [SPEC_PATH]: NOW, [TEST_PATH]: 'it("renders messages", () => {});\n' },
};
const PLANNED = {
  id: "run-1",
  lineId: "spec-tickets",
  lineHash: "line-hash",
  repo: "github.com/acme/widget",
  subjectKey: null,
  startItems: {
    spec_path: valueItem(SPEC_PATH),
    merge_sha: valueItem("c1"),
  },
  outcome: "success",
  reason: null,
  createdAt: "2026-11-09T10:00:00.000Z",
  finishedAt: "2026-11-09T10:30:00.000Z",
};

function scene(files = FILES) {
  const produced: Record<string, string> = {};
  const list = vi.fn(async () => ({ items: [PLANNED], nextCursor: null }));
  const tools: Tools = {
    read: async () => Buffer.from(""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const handle = loadTicketsHandle({
    filed: async () => ({ tasks: new Map() }),
    sourcesFor: async () => ({
      floor: {
        runs: { list, get: async () => null },
        blobs: { get: async () => null },
      },
      readSpec: async (path, ref) => files[ref]?.[path] ?? null,
      firstParent: async () => null,
    }),
  });
  const load = (needs: Record<string, string>) =>
    handle(
      {
        visitId: "load-1",
        iteration: 1,
        needs: {
          target: "https://github.com/acme/widget@main",
          spec_path: SPEC_PATH,
          ...needs,
        },
      },
      tools,
    );

  return { produced, list, load };
}

describe("loadTicketsHandle", () => {
  it("lists the lines whose linked tests settle them, against the spec its last successful run planned", async () => {
    const { produced, load } = scene();

    expect(await load({ merge_sha: "c2" })).toEqual({ outcome: "success" });
    expect(produced).toEqual({
      existing_tickets: "[]",
      settled_statements: '{"since":"c1","lines":[5]}',
    });
  });

  it("settles nothing and asks the floor for nothing when the brief names no merge", async () => {
    const { produced, list, load } = scene();

    expect(await load({})).toEqual({ outcome: "success" });
    expect(produced).toEqual({ existing_tickets: "[]" });
    expect(list).not.toHaveBeenCalled();
  });

  it("lists nothing settled when the merge holds no such spec", async () => {
    const { produced, load } = scene({ c1: FILES.c1 });

    expect(await load({ merge_sha: "c2" })).toEqual({ outcome: "success" });
    expect(produced).toEqual({ existing_tickets: "[]" });
  });

  it("fails the visit when the floor cannot list the spec's earlier runs", async () => {
    const { list, load } = scene();

    list.mockRejectedValueOnce(new Error("floor unavailable"));
    expect(await load({ merge_sha: "c2" })).toEqual({
      outcome: "failed",
      error: "floor unavailable",
    });
  });
});
