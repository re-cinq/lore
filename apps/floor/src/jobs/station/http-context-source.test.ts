import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { HttpContextSource } from "./http-context-source.js";

const spec: LoreTaskSpec = {
  taskId: "abc12345-6789-0000-1111-222233334444",
  taskType: "implementation",
  description: "add retry to the ingest worker",
  prompt: "p",
  targetRepo: "re-cinq/lore",
  branch: "feat/x",
};

const SAVED = { ...process.env };
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.LORE_INGEST_URL = "https://lore.example.com";
  delete process.env.LORE_INGEST_TOKEN;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("HttpContextSource.assemble", () => {
  it("returns undefined without fetching when LORE_INGEST_URL is unset", async () => {
    delete process.env.LORE_INGEST_URL;
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the assembled text and fetches with a timeout signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ text: "conventions..." }));

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBe("conventions...");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain("repo=re-cinq%2Flore");
    expect(url).toContain("template=implementation");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses the review template for review tasks and an empty query without a description", async () => {
    const { description: _description, ...withoutDescription } = spec;
    const reviewSpec = {
      ...withoutDescription,
      taskType: "review",
    } as LoreTaskSpec;
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: "ctx" }));

    vi.stubGlobal("fetch", fetchMock);

    await new HttpContextSource().assemble(reviewSpec);
    const [url] = fetchMock.mock.calls[0] as [string];

    expect(url).toContain("template=review");
    expect(url).toContain("query=&");
  });

  it("sends the bearer header when LORE_INGEST_TOKEN is set", async () => {
    process.env.LORE_INGEST_TOKEN = "tok-123";
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: "ctx" }));

    vi.stubGlobal("fetch", fetchMock);

    await new HttpContextSource().assemble(spec);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toEqual({ Authorization: "Bearer tok-123" });
  });

  it("returns undefined and warns with status and repo on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("re-cinq/lore"),
    );
  });

  it("returns undefined and warns with the error message when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("re-cinq/lore"),
    );
  });

  it("returns undefined and warns when the fetch times out", async () => {
    const timeout = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    const fetchMock = vi.fn().mockRejectedValue(timeout);

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("aborted due to timeout"),
    );
  });

  it("returns undefined when the response carries an empty text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: "" }));

    vi.stubGlobal("fetch", fetchMock);

    expect(await new HttpContextSource().assemble(spec)).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
