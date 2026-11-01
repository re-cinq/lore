import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { store } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  ASSEMBLE_CONTEXT_INPUT,
  registerAssembleContextTool,
} from "./assemble-context.js";

await vi.hoisted(async () => {
  const { mkdtempSync: makeDir } = await import("node:fs");
  const { tmpdir: osTmpdir } = await import("node:os");

  process.env.HOME = makeDir(`${osTmpdir()}/lore-assemble-home-`);
  process.env.CONTEXT_PATH = process.env.HOME;
});

const assembleContext = toolHandlers(registerAssembleContextTool, "full")[
  "lore_assemble_context"
];
const agentAssemble = toolHandlers(registerAssembleContextTool, "agent")[
  "lore_assemble_context"
];
const fetchMock = vi.fn();
const answering = (body: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore.example");
  vi.stubEnv("LORE_INGEST_TOKEN", "test-token");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the lore_assemble_context schema", () => {
  const schema = z.object(ASSEMBLE_CONTEXT_INPUT);

  it("rejects max_tokens below the 2000 floor", () => {
    expect(
      schema.safeParse({ query: "auth flow", max_tokens: 1999 }).success,
    ).toBe(false);
  });

  it("accepts max_tokens at the 2000 floor", () => {
    expect(
      schema.safeParse({ query: "auth flow", max_tokens: 2000 }).success,
    ).toBe(true);
  });

  it("accepts backend both and refuses backend dgraph", () => {
    expect({
      both: schema.safeParse({ query: "q", backend: "both" }).data?.backend,
      dgraph: schema.safeParse({ query: "q", backend: "dgraph" }).success,
    }).toEqual({ both: "both", dgraph: false });
  });
});

describe("lore_assemble_context audit logging", () => {
  it("logs query, template, sources hit, and tokens to console.error after a successful proxy call", async () => {
    answering({
      text: "assembled context block",
      sections: [
        { header: "conventions", tokens: 400, truncated: false },
        { header: "memories", tokens: 150, truncated: false },
      ],
    });
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await assembleContext({
      query: "auth flow",
      template: "review",
      repo: "owner/repo",
    });

    expect(logSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toMatch(
      /query: auth flow, template: review, sources hit: conventions, memories, tokens: 550/,
    );
  });

  it("logs sources none and tokens 0 for an answer with no sections", async () => {
    answering({ text: "bare" });
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await assembleContext({
      query: "no sections",
      template: "default",
      repo: "owner/repo",
    });

    expect({
      text: result.content[0].text,
      logged: logSpy.mock.calls.map((call) => call.join(" ")).join("\n"),
    }).toMatchObject({
      text: "bare",
      logged: expect.stringMatching(/sources hit: none, tokens: 0/),
    });
  });
});

describe("lore_assemble_context request", () => {
  it("gives the API 45s per attempt", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    answering({ text: "t", sections: [] });
    await assembleContext({
      query: "timeout probe assemble",
      template: "default",
      repo: "owner/repo",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });

  it("forwards backend=utopia to GET /api/context", async () => {
    answering({ text: "UTOPIA CONTEXT" });
    await assembleContext({
      query: "q-utopia",
      template: "default",
      repo: "owner/r",
      backend: "utopia",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://lore.example/api/context?query=q-utopia&template=default&repo=owner%2Fr&backend=utopia",
    );
  });

  it("forwards max_tokens 16000, cross_repo true and agent_id agent-7 to GET /api/context", async () => {
    answering({ text: "" });
    await assembleContext({
      query: "q-extras",
      template: "research",
      repo: "owner/r",
      max_tokens: 16000,
      cross_repo: true,
      agent_id: "agent-7",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://lore.example/api/context?query=q-extras&template=research&repo=owner%2Fr&max_tokens=16000&cross_repo=true&agent_id=agent-7",
    );
  });
});

describe("lore_assemble_context proxy path (read-through cache, enabled here since global setup disables it)", () => {
  let cacheDir: string;
  const policy = {
    tool: "lore_assemble_context",
    args: { query: "q", template: "default", repo: "owner/r" },
    repo: "owner/r",
    ttlSeconds: 0,
  };

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "lore-assemble-cache-"));
    vi.stubEnv("LORE_CACHE_DIR", cacheDir);
    delete process.env.LORE_CACHE_ENABLED;
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns an empty-but-reachable context as-is instead of a stale cached copy", async () => {
    store(policy, "OLD CONTEXT");
    answering({ text: "" });

    const result = await assembleContext({
      query: "q",
      template: "default",
      repo: "owner/r",
    });

    expect(result.content[0].text).toBe("");
  });

  it("does not serve a stale cached copy when the backend denies access (403)", async () => {
    store(policy, "OLD CONTEXT");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({}),
    });

    const result = await assembleContext({
      query: "q",
      template: "default",
      repo: "owner/r",
    });

    expect(result.content[0].text).not.toContain("OLD CONTEXT");
    expect(result.content[0].text).toContain("denied access");
  });

  it("returns the live result on a reachable hit", async () => {
    answering({ text: "FRESH CONTEXT" });

    const result = await assembleContext({
      query: "q2",
      template: "default",
      repo: "owner/r",
    });

    expect(result.content[0].text).toBe("FRESH CONTEXT");
  });
});

describe("lore_assemble_context in the agent gateway, which has no checkout", () => {
  it("asks for the repo instead of proxying an empty one when the call names none", async () => {
    const result = await agentAssemble({ query: "q", template: "default" });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      proxied: 0,
    });
  });

  it("reports the API's refusal as a rejection with its reason, not as an unreachable API", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ error: "repo: expected owner/name" }),
    });

    const result = await agentAssemble({
      query: "q-refused",
      template: "default",
      repo: "owner/refused",
    });

    expect(result.content[0].text).toBe(
      "Lore API rejected lore_assemble_context: HTTP 400 Bad Request: repo: expected owner/name",
    );
  });
});

describe("lore_assemble_context with no API configured", () => {
  it("says assembly needs the API when LORE_API_URL is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await assembleContext({
      query: "q",
      template: "default",
      repo: "owner/r",
    });

    expect(result.content[0].text).toBe(
      "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
    );
  });
});
