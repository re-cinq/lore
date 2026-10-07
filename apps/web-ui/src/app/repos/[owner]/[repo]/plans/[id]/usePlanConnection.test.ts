// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { PlanMeta } from "@re-cinq/planning-document";

const planProvider = vi.fn();
const SHARED_SOCKET = { client: "shared" };

vi.mock("@/lib/live-socket/LiveSocketProvider", () => ({
  useLiveSocket: () => SHARED_SOCKET,
}));
vi.mock("@/lib/live-socket/plan-provider", () => ({
  planProvider: (...args: unknown[]) => planProvider(...args) as unknown,
}));
vi.mock("@re-cinq/planning-editor", () => ({
  transportFor: () => ({ destroy: () => undefined }),
}));

const { usePlanConnection } = await import("./usePlanConnection");

const SOCKET_URL = "/api/repos/acme/shop/plans/p1/socket";

const META: PlanMeta = {
  schemaVersion: 1,
  id: "p1",
  repo: "acme/shop",
  type: "feature",
  templateVersion: 1,
  title: "Faster checkout",
  status: "draft",
  approval: null,
  version: 7,
  createdBy: "ana",
  updatedAt: "2026-10-05T10:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

const answer = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status });

const connected = async (meta: PlanMeta) => {
  const hook = renderHook(
    (props: { meta: PlanMeta }) => usePlanConnection(props.meta),
    { initialProps: { meta } },
  );

  await waitFor(() => expect(hook.result.current).not.toBeNull());

  return hook;
};

beforeEach(() => {
  planProvider.mockReset();
  planProvider.mockReturnValue({ provider: {}, destroy: () => undefined });
  fetchMock = vi.fn(async () =>
    answer(200, { documentName: "plan:acme/shop:p1", token: "t1" }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePlanConnection", () => {
  it("keeps one socket when a refresh hands plan p1 back at version 8, as a save does while someone types", async () => {
    const hook = await connected(META);

    hook.rerender({
      meta: { ...META, version: 8, updatedAt: "2026-10-05T10:00:05.000Z" },
    });
    await waitFor(() => expect(hook.result.current).not.toBeNull());

    expect({
      opened: planProvider.mock.calls.length,
      asked: fetchMock.mock.calls.length,
    }).toEqual({ opened: 1, asked: 1 });
  });

  it("opens a new socket when plan p1 is approved", async () => {
    const hook = await connected(META);

    hook.rerender({ meta: { ...META, status: "approved" } });
    await waitFor(() => expect(planProvider).toHaveBeenCalledTimes(2));
  });

  it("asks the socket route, never a server action, for every reconnect's token", async () => {
    await connected(META);
    const token = planProvider.mock.calls[0][2] as () => Promise<string>;

    fetchMock.mockResolvedValueOnce(
      answer(200, { documentName: "plan:acme/shop:p1", token: "t2" }),
    );

    expect({
      token: await token(),
      urls: fetchMock.mock.calls.map(([url]) => String(url)),
    }).toEqual({ token: "t2", urls: [SOCKET_URL, SOCKET_URL] });
  });

  it("hands a reconnect an empty token rather than throwing when the route cannot be reached", async () => {
    await connected(META);
    const token = planProvider.mock.calls[0][2] as () => Promise<string>;

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await token()).toBe("");
  });

  it("reports the route's refusal for someone who cannot see acme/shop", async () => {
    fetchMock.mockImplementation(async () =>
      answer(403, { error: "You do not have access to this repo." }),
    );
    const hook = await connected(META);

    expect(hook.result.current).toEqual({
      error: "You do not have access to this repo.",
    });
  });
});
