import { describe, it, expect, afterEach, vi } from "vitest";
import { buildServer } from "../server.js";
import { parseTail } from "./agent-logs.js";
import type {
  PodLogSource,
  AgentPodInfo,
  PodSummary,
} from "../../../jobs/station/agent-pod-logs.js";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
});

const source: PodLogSource = {
  agentInfo: (name): Promise<AgentPodInfo | null> =>
    Promise.resolve(
      name === "05fc5491-review"
        ? { phase: "Running", jobName: "job-review" }
        : null,
    ),
  podsForJob: (): Promise<PodSummary[]> =>
    Promise.resolve([
      { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
    ]),
  podLog: (): Promise<string> => Promise.resolve("agent stdout line"),
};

function server() {
  return buildServer({ getJobStatus: () => ({}), podLogSource: source });
}

describe("GET /api/agent-logs/{name}", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await server().inject({
      method: "GET",
      url: "/api/agent-logs/05fc5491-review",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns the pod logs for a resolvable Agent CR", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await server().inject({
      method: "GET",
      url: "/api/agent-logs/05fc5491-review",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({
      available: true,
      logs: "agent stdout line",
      phase: "Running",
      podName: "pod-review",
    });
  });

  it("returns available:false with a reason when the CR is gone", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await server().inject({
      method: "GET",
      url: "/api/agent-logs/missing-node",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ available: false, reason: "no-agent" });
  });
});

describe("parseTail", () => {
  it("caps an over-large value at the maximum", () => {
    expect(parseTail("2000000000")).toBe(50_000);
  });

  it("keeps a reasonable value as-is", () => {
    expect(parseTail("200")).toBe(200);
  });

  it("falls back to the default for non-positive or non-numeric input", () => {
    expect(parseTail("-5")).toBe(5000);
    expect(parseTail("abc")).toBe(5000);
    expect(parseTail(undefined)).toBe(5000);
  });
});

describe("request-error logging (#1319)", () => {
  it("names an unexpected route throw on the console instead of 500ing anonymously", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing: PodLogSource = {
      agentInfo: () => Promise.reject(new Error("etcdserver: leader changed")),
      podsForJob: () => Promise.resolve([]),
      podLog: () => Promise.resolve(""),
    };
    try {
      const res = await buildServer({
        getJobStatus: () => ({}),
        podLogSource: throwing,
      }).inject({
        method: "GET",
        url: "/api/agent-logs/05fc5491-review",
        headers: { authorization: "Bearer ingest-secret" },
      });

      expect(res.statusCode).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[http] GET /api/agent-logs/05fc5491-review 500",
        ),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("etcdserver: leader changed"),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
