import { afterEach, describe, expect, it, vi } from "vitest";
import type { DgraphClientPort } from "@re-cinq/lore-shared";
import {
  projectSpecMetered,
  type ProjectSpec,
  type ProjectionWaits,
} from "./spec-projection-meter.js";

const WIDGET = {
  repo: "re-cinq/lore",
  filePath: "specs/widget/spec.md",
  content: [
    "# Widget",
    "",
    "## Requirements",
    "",
    "- FR-1 The widget MUST spin. ([validated by spins once @1a2b3c4d](apps/widget/spin.test.ts#L3))",
    "- FR-2 The widget MUST stop. ([implemented by stop @5e6f7a8b](apps/widget/stop.ts#L9))",
    "- FR-3 The widget MUST rest.",
    "",
  ].join("\n"),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the line a projected spec logs", () => {
  it("says 3 statements and 2 links took 13s, 9s of it in 3 graph requests, 2s embedding and 1s in 1 file read", async () => {
    expect(
      await logOf(
        projecting,
        [
          0, 1_000, 4_000, 4_000, 7_000, 7_000, 9_000, 9_000, 10_000, 10_000,
          13_000, 13_000,
        ],
      ),
    ).toEqual([
      "[project-spec] re-cinq/lore@9f8f7e246 specs/widget/spec.md: 3 statements and 2 links in 13s; 3 graph requests took 9s, embedding 2s, 1 file reads 1s",
    ]);
  });

  it("logs nothing for a spec skipped as unchanged", async () => {
    expect(await logOf(async () => ({ projected: false }), [0, 0])).toEqual([]);
  });

  it("hands the projection the graph's, the embedder's and the file reader's own answers", async () => {
    const seen: unknown[] = [];

    await projectSpecMetered(
      async (_document, dgraph, { embed, readLinked }) => {
        seen.push(
          await dgraph.newTxn().queryWithVars("query", {}),
          await embed(["FR-1"]),
          await readLinked("apps/widget/spin.test.ts"),
        );

        return { projected: false };
      },
      WIDGET,
      waits(),
    );

    expect(seen).toEqual([
      { data: { found: [{ uid: "0x1" }] } },
      [[0.5]],
      "spins once",
    ]);
  });
});

const projecting: ProjectSpec = async (_document, dgraph, options) => {
  const txn = dgraph.newTxn();

  await txn.queryWithVars("query", {});
  await txn.mutate({ commitNow: true });
  await options.embed(["FR-1", "FR-2", "FR-3"]);
  await options.readLinked("apps/widget/spin.test.ts");
  await dgraph.newTxn().mutate({ commitNow: true });

  return { projected: true };
};

async function logOf(project: ProjectSpec, times: number[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  await projectSpecMetered(project, WIDGET, waits(), () => times.shift() ?? 0);

  return log.mock.calls.map(([line]) => String(line));
}

function waits(): ProjectionWaits {
  return {
    dgraph: graph,
    embed: async (texts) => texts.map(() => [0.5]),
    readLinked: async () => "spins once",
    commit: "9f8f7e246e594f2bdf89e8e689b9ca0b431508f7",
    force: false,
  };
}

const graph: DgraphClientPort = {
  newTxn: () => ({
    queryWithVars: async () => ({ data: { found: [{ uid: "0x1" }] } }),
    mutate: async () => ({}),
    discard: async () => undefined,
  }),
};
