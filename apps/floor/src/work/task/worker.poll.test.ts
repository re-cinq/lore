import { describe, it, expect } from "vitest";
import { pollWithGuard } from "./worker.js";

describe("pollWithGuard (single-flight)", () => {
  it("claims and processes one task", async () => {
    const processed: string[] = [];

    await pollWithGuard({
      claim: async () => "t1",
      process: async (t) => {
        processed.push(t);
      },
    });
    expect(processed).toEqual(["t1"]);
  });

  it("does nothing when there is no runnable task", async () => {
    let processedCount = 0;

    await pollWithGuard({
      claim: async () => null,
      process: async () => {
        processedCount += 1;
      },
    });
    expect(processedCount).toBe(0);
  });

  it("skips a concurrent tick while a task is still processing", async () => {
    let claims = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps = {
      claim: async () => {
        claims += 1;

        return "t";
      },
      process: async () => {
        await gate;
      },
    };

    const first = pollWithGuard(deps);
    const second = pollWithGuard(deps);

    await second;
    expect(claims).toBe(1);

    release();
    await first;
  });
});
