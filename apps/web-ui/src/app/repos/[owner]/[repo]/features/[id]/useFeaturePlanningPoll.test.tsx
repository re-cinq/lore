// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFeaturePlanningPoll } from "./useFeaturePlanningPoll";
import type { FeaturePollPayload } from "@/lib/feature-poll";

const seed = {
  feature: { id: "f1", title: "seed" },
  latestIteration: null,
  task: null,
  liveOutput: null,
  lastReady: null,
  run: null,
} as unknown as FeaturePollPayload;

function payload(title: string): FeaturePollPayload {
  return { ...seed, feature: { ...seed.feature, title } };
}

function stubFetch(...bodies: FeaturePollPayload[]) {
  let call = 0;
  const fetchStub = vi.fn(async (_url: string) => {
    const body = bodies[Math.min(call, bodies.length - 1)];

    call += 1;

    return { ok: true, json: async () => body } as Response;
  });

  global.fetch = fetchStub as unknown as typeof fetch;

  return fetchStub;
}

describe("useFeaturePlanningPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the seed before the mount fetch resolves", () => {
    stubFetch(payload("fetched"));
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    expect(result.current.data.feature.title).toEqual("seed");
  });

  it("replaces the seed with the mount fetch payload", async () => {
    stubFetch(payload("fetched"));
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    await waitFor(() =>
      expect(result.current.data.feature.title).toEqual("fetched"),
    );
  });

  it("polls the feature route every 4000ms", async () => {
    const fetchStub = stubFetch(payload("first"), payload("second"));
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    expect(fetchStub.mock.calls[0]?.[0]).toEqual(
      "/api/repos/re-cinq/lore/features/f1",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() =>
      expect(result.current.data.feature.title).toEqual("second"),
    );
  });

  it("stops polling after unmount", async () => {
    const fetchStub = stubFetch(payload("first"));
    const { unmount } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("keeps the last payload when a poll returns 500", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(result.current.data.feature.title).toEqual("seed");
  });

  it("refresh() returns the freshly fetched payload", async () => {
    stubFetch(payload("first"), payload("second"));
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    await waitFor(() =>
      expect(result.current.data.feature.title).toEqual("first"),
    );
    const returned = await act(async () => result.current.refresh());

    expect(returned?.feature.title).toEqual("second");
  });

  it("refresh() returns null when the route answers 500", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useFeaturePlanningPoll({
        owner: "re-cinq",
        repo: "lore",
        featureId: "f1",
        initial: seed,
      }),
    );

    const returned = await act(async () => result.current.refresh());

    expect(returned).toEqual(null);
  });
});
