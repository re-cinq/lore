// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

describe("SearchPage memory retrieval", () => {
  let server: http.Server;
  let requests: { url: string }[] = [];
  const originalLoreApiUrl = process.env.LORE_API_URL;

  beforeAll(async () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        requests.push({ url: req.url || "" });
        res.writeHead(200, { "Content-Type": "application/json" });

        if (req.url?.includes("/api/repos")) {
          res.end(
            JSON.stringify({
              repos: [{ full_name: "re-cinq/lore" }],
              total: 1,
            }),
          );
        }

        if (!req.url?.includes("/api/repos")) {
          res.end(JSON.stringify({ results: [], chunks: [] }));
        }
      });
      server.listen(0, () => {
        process.env.LORE_API_URL = `http://localhost:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    if (originalLoreApiUrl === undefined) {
      delete process.env.LORE_API_URL;
    }

    if (originalLoreApiUrl !== undefined) {
      process.env.LORE_API_URL = originalLoreApiUrl;
    }
    server.close();
  });

  it("propagates the selected repo into memory/fact retrieval", async () => {
    const { default: SearchPage } = await import("./page");

    requests = [];

    await SearchPage({
      searchParams: Promise.resolve({ q: "deploy", repo: "re-cinq/lore" }),
    });

    const memorySearchReq = requests.find((r) =>
      r.url.includes("/api/memory-search"),
    );

    expect(memorySearchReq).toBeDefined();
    expect(memorySearchReq?.url).toContain("repo=re-cinq%2Flore");
  });
});
