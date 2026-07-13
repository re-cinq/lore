import { enforceTrue } from "./enforce.js";
import { describe, it, expect, vi } from "vitest";
import { withBackoff } from "./backoff.js";

describe("withBackoff", () => {
  it("returns the result on the first try without sleeping", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await withBackoff(async () => "ok", {
      delaysMs: [1000, 4000],
      sleep,
    });
    expect(result).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries after each delay and awaits every configured delay (delaysMs.length + 1 attempts)", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        enforceTrue(calls >= 3, new Error(`fail ${calls}`));
        return "recovered";
      },
      { delaysMs: [1000, 4000], sleep },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 4000]);
  });

  it("rethrows the last error after exhausting all attempts", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { delaysMs: [1000, 4000], sleep },
      ),
    ).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 4000]);
  });
});
