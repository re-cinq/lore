// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { apiFetch } = await import("./client");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_FLOOR_URL = "http://floor:8080";
  process.env.LORE_ADMIN_TOKEN = "admin";
  process.env.LORE_INGEST_TOKEN = "ingest";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const init = () => fetchMock.mock.calls[0][1];

describe("apiFetch", () => {
  it("prefers the admin token for lore-api, since the UI performs privileged writes the ingest token cannot", async () => {
    await apiFetch("lore-api", "/api/x");
    expect(init().headers.authorization).toBe("Bearer admin");
  });

  it("falls back to the ingest token when no admin token is set", async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    await apiFetch("lore-api", "/api/x");
    expect(init().headers.authorization).toBe("Bearer ingest");
  });

  it("targets the floor with the ingest token", async () => {
    await apiFetch("floor", "/api/y");
    expect(fetchMock.mock.calls[0][0]).toBe("http://floor:8080/api/y");
    expect(init().headers.authorization).toBe("Bearer ingest");
  });

  it("reports unconfigured when the base URL is missing", async () => {
    delete process.env.LORE_API_URL;
    expect(await apiFetch("lore-api", "/api/x")).toEqual({
      status: "unconfigured",
    });
  });

  it("reports unconfigured when no token is available", async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    delete process.env.LORE_INGEST_TOKEN;
    expect(await apiFetch("lore-api", "/api/x")).toEqual({
      status: "unconfigured",
    });
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
