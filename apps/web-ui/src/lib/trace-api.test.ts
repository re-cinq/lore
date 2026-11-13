import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lore-api-get", () => ({ loreApiGet: vi.fn() }));

import { loreApiGet } from "@/lib/lore-api-get";
import { fetchTraceGraph } from "./trace-api";

describe("fetchTraceGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the spec's bounded force-graph via ?path= and falls back to an empty graph", async () => {
    vi.mocked(loreApiGet).mockResolvedValueOnce(null);

    const graph = await fetchTraceGraph("o/r", "specs/auth/spec.md");

    expect(loreApiGet).toHaveBeenCalledWith(
      "/api/repos/o/r/trace/graph?path=specs%2Fauth%2Fspec.md",
    );
    expect(graph).toEqual({ nodes: [], links: [] });
  });
});
