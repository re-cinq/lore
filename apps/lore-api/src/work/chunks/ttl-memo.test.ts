import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  memoizeByKeyStaleWhileRefreshing,
  memoizeByKeyWithTtl,
  memoizeWithTtl,
} from "./ttl-memo.js";

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

describe("memoizeByKeyWithTtl", () => {
  it("reads re-cinq/lore once for two asks within 20 seconds, again after, and re-cinq/otto on its own", async () => {
    let now = 0;
    const reads: string[] = [];
    const read = memoizeByKeyWithTtl(
      async (key: string) => {
        reads.push(key);

        return key.length;
      },
      20_000,
      () => now,
    );

    await read("re-cinq/lore");
    await read("re-cinq/lore");
    await read("re-cinq/otto");
    now = 20_001;
    await read("re-cinq/lore");

    expect(reads).toEqual(["re-cinq/lore", "re-cinq/otto", "re-cinq/lore"]);
  });
});

describe("memoizeByKeyStaleWhileRefreshing", () => {
  const WINDOW = { freshMs: 20_000, staleMs: 10 * 60_000 };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  function clockedMemo(fn: (key: string) => Promise<string>) {
    let clock = 0;
    const memo = memoizeByKeyStaleWhileRefreshing(fn, WINDOW, () => clock);

    return { memo, advance: (ms: number) => (clock += ms) };
  }

  it("answers the kept value at once 30 s later and refreshes it once in the background", async () => {
    const read = vi
      .fn<(key: string) => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const { memo, advance } = clockedMemo(read);

    await memo("repo");
    advance(30_000);
    const answers = await Promise.all([memo("repo"), memo("repo")]);

    await settle();

    expect({
      answers,
      reads: read.mock.calls.length,
      afterRefresh: await memo("repo"),
    }).toEqual({
      answers: ["first", "first"],
      reads: 2,
      afterRefresh: "second",
    });
  });

  it("waits for the read 11 minutes later", async () => {
    const read = vi
      .fn<(key: string) => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const { memo, advance } = clockedMemo(read);

    await memo("repo");
    advance(11 * 60_000);

    expect(await memo("repo")).toBe("second");
  });

  it("keeps the old value when the background refresh fails", async () => {
    const read = vi
      .fn<(key: string) => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockRejectedValue(new Error("github away"));
    const { memo, advance } = clockedMemo(read);

    await memo("repo");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    advance(30_000);
    await memo("repo");
    await settle();
    const warned = warn.mock.calls.length;

    expect({ kept: await memo("repo"), warned }).toEqual({
      kept: "first",
      warned: 1,
    });
    warn.mockRestore();
  });

  it("shares one first read between concurrent callers", async () => {
    const read = vi
      .fn<(key: string) => Promise<string>>()
      .mockResolvedValue("v");
    const { memo } = clockedMemo(read);

    await Promise.all([memo("repo"), memo("repo")]);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
