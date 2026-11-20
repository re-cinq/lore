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

const ME = {
  login: "ada",
  name: "Ada",
  avatar_url: "https://avatars.example.com/ada",
  scopes: ["admin"],
  started_at: "2026-11-18T10:00:00.000Z",
  expires_at: "2026-11-19T10:00:00.000Z",
};

describe("an answer that decides who gets in", () => {
  const answering = (body: string) =>
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

  it.each([
    ["a proxy's HTML page", "<html>ok</html>"],
    ["an empty body", ""],
    ["an empty object", "{}"],
    ["an empty login", JSON.stringify({ login: "" })],
    ["a login that is not text", JSON.stringify({ login: 7 })],
    ["a JSON list", "[]"],
    ["a JSON null", "null"],
  ])("is no session when lore-api's 200 holds %s", async (_case, body) => {
    answering(body);

    expect(await getMe()).toEqual({
      status: "error",
      message: "lore-api's answer was not understood",
    });
  });

  it.each([
    ["no name", { name: undefined }],
    ["no avatar_url", { avatar_url: undefined }],
    ["no scopes", { scopes: undefined }],
    ["scopes that are not a list", { scopes: "admin" }],
    ["a scope that is not text", { scopes: ["admin", 7] }],
    ["no started_at", { started_at: undefined }],
    ["no expires_at", { expires_at: undefined }],
    ["an expires_at that is a number", { expires_at: 7 }],
  ])(
    "is no session when lore-api's 200 has a login but %s",
    async (_case, change) => {
      answering(JSON.stringify({ ...ME, ...change }));

      expect(await getMe()).toEqual({
        status: "error",
        message: "lore-api's answer was not understood",
      });
    },
  );

  it.each([
    ["with an avatar and an expiry", ME],
    ["with neither", { ...ME, avatar_url: null, expires_at: null }],
  ])(
    "is a session when lore-api's 200 is its whole answer %s",
    async (_case, me) => {
      answering(JSON.stringify(me));

      expect(await getMe()).toEqual({ status: "ok", data: me });
    },
  );

  it.each([
    ["a proxy's HTML page", "<html>ok</html>"],
    ["an empty object", "{}"],
    ["a yes that is not a boolean", JSON.stringify({ allowed: "true" })],
    ["a one that is not a boolean", JSON.stringify({ allowed: 1 })],
  ])("is no repo access when lore-api's 200 holds %s", async (_case, body) => {
    answering(body);

    expect(await repoAccess("acme/app")).toEqual({
      status: "error",
      message: "lore-api's answer was not understood",
    });
  });

  it("keeps lore-api's own refusal as it is", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "no" }), { status: 401 }),
    );

    expect(await getMe()).toMatchObject({ status: "error", code: 401 });
  });
});
