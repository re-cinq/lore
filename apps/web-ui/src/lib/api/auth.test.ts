// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { endSession, getMe, redeemCode, repoAccess } = await import("./auth");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ allowed: true })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = () => fetchMock.mock.calls[0] as [string, RequestInit];

describe("lore-api's sign-in routes", () => {
  it("asks who the session token belongs to", async () => {
    await getMe();

    expect(lastCall()[0]).toBe("http://api:3000/api/auth/me");
  });

  it("asks whether the person may open a repo, naming it escaped", async () => {
    await repoAccess("re-cinq/lore");

    expect(lastCall()[0]).toBe(
      "http://api:3000/api/auth/access?repo=re-cinq%2Flore",
    );
  });

  it("gives the access question a deadline so a hung lore-api cannot pin the proxy routes", async () => {
    await repoAccess("re-cinq/lore");

    expect(lastCall()[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("swaps a code for a session token without sending any bearer", async () => {
    await redeemCode("code-1");
    const [url, init] = lastCall();

    expect({
      url,
      method: init.method,
      body: init.body,
      bearer: (init.headers as Record<string, string>).authorization,
    }).toEqual({
      url: "http://api:3000/api/auth/redeem",
      method: "POST",
      body: '{"code":"code-1"}',
      bearer: undefined,
    });
  });

  it("ends the session with a post carrying the session token", async () => {
    await endSession();
    const [url, init] = lastCall();

    expect({
      url,
      method: init.method,
      bearer: (init.headers as Record<string, string>).authorization,
    }).toEqual({
      url: "http://api:3000/api/auth/logout",
      method: "POST",
      bearer: "Bearer session-token",
    });
  });
});
