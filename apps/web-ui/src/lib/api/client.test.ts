// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const sessionToken = vi.fn();

vi.mock("@/lib/session-token", () => ({ sessionToken }));

const { apiFetch } = await import("./client");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  sessionToken.mockResolvedValue("session-1");
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const init = () => fetchMock.mock.calls[0][1];

describe("apiFetch", () => {
  it("sends the signed-in person's session token to lore-api", async () => {
    await apiFetch("lore-api", "/api/x");
    expect(init().headers.authorization).toBe("Bearer session-1");
  });

  it("sends the token a caller brings when it has no request to read the cookie from", async () => {
    await apiFetch("lore-api", "/api/x", { token: "from-middleware" });
    expect(init().headers.authorization).toBe("Bearer from-middleware");
  });

  it("sends no bearer to a public route and needs none", async () => {
    sessionToken.mockResolvedValue(null);
    await apiFetch("lore-api", "/api/x", { anonymous: true });
    expect(init().headers).not.toHaveProperty("authorization");
  });

  it("reports unconfigured when the base URL is missing", async () => {
    delete process.env.LORE_API_URL;
    expect(await apiFetch("lore-api", "/api/x")).toEqual({
      status: "unconfigured",
    });
  });

  it("reports unconfigured when there is no session", async () => {
    sessionToken.mockResolvedValue(null);
    expect(await apiFetch("lore-api", "/api/x")).toEqual({
      status: "unconfigured",
    });
  });

  it("gives a call the deadline it asks for, so a hung lore-api cannot pin the caller", async () => {
    await apiFetch("lore-api", "/api/x", { timeoutMs: 30_000 });
    expect(init().signal).toBeInstanceOf(AbortSignal);
  });

  it("sets no deadline on a call that asks for none", async () => {
    await apiFetch("lore-api", "/api/x");
    expect(init().signal).toBeUndefined();
  });

  it("sends a JSON body on a write", async () => {
    await apiFetch("lore-api", "/api/x", { method: "POST", body: { a: 1 } });
    expect(init()).toMatchObject({ method: "POST", body: '{"a":1}' });
  });

  it("omits the body entirely for a DELETE", async () => {
    await apiFetch("lore-api", "/api/x", { method: "DELETE" });
    expect(init()).not.toHaveProperty("body");
  });

  it("is uncached by default, which is what a poll needs", async () => {
    await apiFetch("lore-api", "/api/x");
    expect(init().cache).toBe("no-store");
  });

  it("caches for the given window when one is asked for", async () => {
    await apiFetch("lore-api", "/api/x", { revalidate: 300 });
    expect(init().next).toEqual({ revalidate: 300 });
    expect(init().cache).toBeUndefined();
  });

  it("reports a refused connection rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await apiFetch("lore-api", "/api/x")).toEqual({
      status: "error",
      message: "ECONNREFUSED",
    });
  });
});
