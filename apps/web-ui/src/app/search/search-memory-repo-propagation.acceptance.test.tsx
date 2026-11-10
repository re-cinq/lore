// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

describe("SearchPage memory retrieval", () => {
  let server: http.Server;
  let requests: { url: string }[] = [];

  beforeAll(async () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        requests.push({ url: req.url || "" });
        res.writeHead(200, { "Content-Type": "application/json" });

        if (req.url?.includes("/api/repos")) {
          res.end(JSON.stringify({ status: "ok", data: { repos: [{ full_name: "re-cinq/lore" }] } }));
        }

        if (!req.url?.includes("/api/repos")) {
          res.end(JSON.stringify({ status: "ok", data: { results: [], chunks: [] } }));
        }
      });
      server.listen(0, () => {
        process.env.LORE_API_URL = `http://localhost:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it("propagates the selected repo into memory/fact retrieval", async () => {
    const { default: SearchPage } = await import("./page");

    requests = [];
    
    try {
      await SearchPage({ searchParams: Promise.resolve({ q: "deploy", repo: "re-cinq/lore" }) });
    } catch (_e: any) {
      void _e;
    }
    
    const memorySearchReq = requests.find(r => r.url.includes("/api/memory-search"));

    expect(memorySearchReq).toBeDefined();
    expect(memorySearchReq?.url).toContain("repo=re-cinq%2Flore");
  });
});
