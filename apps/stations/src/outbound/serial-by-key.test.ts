import { describe, expect, it } from "vitest";
import { serialByKey } from "./serial-by-key.js";

function gate(): { open: () => void; opened: Promise<void> } {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, opened };
}

describe("serialByKey", () => {
  it("starts the second job of key acme/app only after the first one ended and lets another key run at once", async () => {
    const inOrder = serialByKey();
    const events: string[] = [];
    const firstGate = gate();
    const first = inOrder("acme/app", async () => {
      events.push("first start");
      await firstGate.opened;
      events.push("first end");
    });
    const second = inOrder("acme/app", async () => {
      events.push("second start");
    });
    const other = inOrder("acme/other", async () => {
      events.push("other start");
    });

    await other;
    firstGate.open();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "first start",
      "other start",
      "first end",
      "second start",
    ]);
  });

  it("runs the second job and rejects only the first when the first job fails", async () => {
    const inOrder = serialByKey();
    const first = inOrder("acme/app", async () => {
      throw new Error("git failed");
    });
    const second = inOrder("acme/app", async () => "ran");

    await expect(first).rejects.toThrow(new Error("git failed"));
    expect(await second).toEqual("ran");
  });
});
