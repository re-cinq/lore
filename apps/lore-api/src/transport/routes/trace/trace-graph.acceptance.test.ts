import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  useRateLimitSafeClock,
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const base = "/api/repos/o/r/trace/graph";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/repos/:owner/:repo/trace/graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 400 to refuse an unbounded read of a whole repository", async () => {
    vi.mocked(projectFor).mockResolvedValue({
      trace: { graph: vi.fn().mockResolvedValue({ nodes: [], links: [] }) },
    } as never);

    const res = await get(base);

    expect(res.statusCode).toBe(400);
  });

  it("forwards the requested path to trace.graph", async () => {
    const graph = vi.fn().mockResolvedValue({ nodes: [], links: [] });

    vi.mocked(projectFor).mockResolvedValue({
      trace: { graph },
    } as never);

    const res = await get(`${base}?path=specs/auth/spec.md`);

    expect(res.statusCode).toBe(200);
    expect(graph).toHaveBeenCalledWith("specs/auth/spec.md");
  });
});
