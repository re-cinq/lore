import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoizeWithTtl } from "./ttl-memo.js";

describe("memoizeWithTtl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the function once within the ttl", async () => {
    const fn = vi.fn().mockResolvedValue("value");
    const memoized = memoizeWithTtl(fn, 30_000);

    await expect(memoized()).resolves.toBe("value");
    vi.advanceTimersByTime(29_999);
    await expect(memoized()).resolves.toBe("value");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes the function again after the ttl expires", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const memoized = memoizeWithTtl(fn, 30_000);

    await expect(memoized()).resolves.toBe("first");
    vi.advanceTimersByTime(30_000);
    await expect(memoized()).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("shares one invocation between concurrent callers", async () => {
    const fn = vi.fn().mockResolvedValue("value");
    const memoized = memoizeWithTtl(fn, 30_000);

    await expect(Promise.all([memoized(), memoized()])).resolves.toEqual([
      "value",
      "value",
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clears the cache on rejection and retries on the next call", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");
    const memoized = memoizeWithTtl(fn, 30_000);

    await expect(memoized()).rejects.toThrow(new Error("boom"));
    await expect(memoized()).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer cache entry when a stale invocation rejects", async () => {
    let rejectFirst: (err: Error) => void = () => undefined;
    const fn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce("second");
    const memoized = memoizeWithTtl(fn, 30_000);

    const stale = memoized();

    vi.advanceTimersByTime(30_000);
    await expect(memoized()).resolves.toBe("second");
    rejectFirst(new Error("stale"));
    await expect(stale).rejects.toThrow(new Error("stale"));
    await expect(memoized()).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
