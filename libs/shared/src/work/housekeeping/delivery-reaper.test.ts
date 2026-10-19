import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDeliveryReaper } from "./delivery-reaper.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startDeliveryReaper", () => {
  it("reaps stuck deliveries once a minute", async () => {
    let reaps = 0;
    const timer = startDeliveryReaper(() => Promise.resolve(++reaps));

    await vi.advanceTimersByTimeAsync(180_000);
    clearInterval(timer);

    expect(reaps).toBe(3);
  });

  it("keeps reaping after one reap fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reaps = 0;
    const timer = startDeliveryReaper(() =>
      ++reaps === 1
        ? Promise.reject(new Error("pool down"))
        : Promise.resolve(0),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    clearInterval(timer);

    expect(reaps).toBe(2);
  });
});
