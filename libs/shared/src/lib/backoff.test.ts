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
        enforceTrue(calls >= 3, Error, `fail ${calls}`);

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

  it("rethrows an error rejected by retryOn immediately: 1 attempt, 0 sleeps", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;

    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error("schema violation");
        },
        {
          delaysMs: [1000, 4000],
          sleep,
          retryOn: (err) =>
            err instanceof Error && err.message.includes("abort"),
        },
      ),
    ).rejects.toThrow("schema violation");
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps the full schedule for errors retryOn accepts: 2 aborts then success sleeps 1000ms then 4000ms", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        enforceTrue(calls >= 3, Error, "abort, please retry");

        return "recovered";
      },
      {
        delaysMs: [1000, 4000],
        sleep,
        retryOn: (err) => err instanceof Error && err.message.includes("abort"),
      },
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 4000]);
  });

  it("retries every error when retryOn is omitted", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        enforceTrue(calls >= 2, Error, "any error at all");

        return "recovered";
      },
      { delaysMs: [500], sleep },
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});
