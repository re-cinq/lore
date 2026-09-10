import { describe, it, expect } from "vitest";
import { createDropOverlayOnClose } from "./drop-overlay.js";
import type { EventInput } from "../../domain/event-types.js";

async function eventsFor(
  params: Record<string, unknown>,
): Promise<EventInput[]> {
  const inserted: EventInput[] = [];

  await createDropOverlayOnClose(async (event) => {
    inserted.push(event);
  })(params);

  return inserted;
}

describe("createDropOverlayOnClose", () => {
  it("asks the ingest to drop the feat/x overlay when the merged feat/x PR closes", async () => {
    expect(
      await eventsFor({
        repo: "o/r",
        pr_number: 7,
        merged: true,
        branch: "feat/x",
      }),
    ).toEqual([
      {
        eventName: "internal.ingest.spec_trace",
        source: "internal",
        params: {
          repo: "o/r",
          kind: "overlay-drop",
          payload: { overlayBranch: "feat/x" },
        },
      },
    ]);
  });

  it("asks for the same drop when the feat/x PR closes unmerged", async () => {
    expect(
      await eventsFor({
        repo: "o/r",
        pr_number: 7,
        merged: false,
        branch: "feat/x",
      }),
    ).toMatchObject([{ params: { payload: { overlayBranch: "feat/x" } } }]);
  });

  it("asks for nothing when the closed PR names no head branch", async () => {
    expect(await eventsFor({ repo: "o/r", pr_number: 7, branch: "" })).toEqual(
      [],
    );
  });
});
