import { afterEach, describe, expect, it, vi } from "vitest";
import type { IngestDeltaDeps } from "./ingest-delta-deps.js";
import { applyDocDelta, type DocDelta } from "./ingest-doc-delta.js";

const COMMIT = "5acefde73b0c0d0e0f";
const WIDGET = { path: "specs/widget/spec.md", content: "# Widget\n" };
const GADGET = { path: "specs/gadget/spec.md", content: "# Gadget\n" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the line a doc chunk logs", () => {
  it("says chunk 5/18 of specs projected 1 of 2 files in 3s and mirrored in 7s", async () => {
    expect(
      await logOf(
        { files: [WIDGET, GADGET], seq: 5, total: 18 },
        [1_000, 4_000, 11_000],
      ),
    ).toEqual([
      "[ingest-delta] specs re-cinq/lore@5acefde73 chunk 5/18: projected 1 of 2 files in 3s, mirrored in 7s",
    ]);
  });

  it("calls a delta that fits one body chunk 1/1", async () => {
    expect(await logOf({ files: [WIDGET] }, [0, 0, 0])).toEqual([
      "[ingest-delta] specs re-cinq/lore@5acefde73 chunk 1/1: projected 1 of 1 files in 0s, mirrored in 0s",
    ]);
  });

  it("counts a delta with no files as 0 of 0 when a push changed no spec", async () => {
    expect(await logOf({}, [0, 0, 0])).toEqual([
      "[ingest-delta] specs re-cinq/lore@5acefde73 chunk 1/1: projected 0 of 0 files in 0s, mirrored in 0s",
    ]);
  });
});

async function logOf(
  delta: Partial<DocDelta>,
  times: number[],
): Promise<string[]> {
  const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const clock = vi.spyOn(Date, "now");

  times.forEach((time) => clock.mockReturnValueOnce(time));
  await applyDocDelta(deps(), "re-cinq/lore", {
    kind: "specs",
    commit: COMMIT,
    ...delta,
  });

  return logged.mock.calls.map(([line]) => String(line));
}

function deps(): IngestDeltaDeps {
  let projectedOne = false;
  const projectSpec = async () => {
    const projected = !projectedOne;

    projectedOne = true;

    return { projected };
  };

  return {
    projectSpec,
    deleteSpec: async () => undefined,
    listSpecs: async () => [],
    mirrorDoc: async () => undefined,
    unmirrorDoc: async () => undefined,
  } as never;
}
