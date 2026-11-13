// @vitest-environment node
import { GET } from "./route";
import { createServer } from "http";
import { test, expect, beforeAll, afterAll } from "vitest";

let server: ReturnType<typeof createServer>;
let url: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/repos/available")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ full_name: "some/not-onboarded" }]));

      return;
    }

    if (req.url?.startsWith("/api/repos")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ repos: [], total: 0 }));

      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as any;

  url = `http://127.0.0.1:${address.port}`;
  process.env.LORE_API_URL = url;
});

afterAll(() => {
  server.close();
});

test("returns App-accessible, not-yet-onboarded repositories instead of hardcoded list", async () => {
  const response = await GET();

  expect(response.status).toBe(200);

  const json = await response.json();

  expect(json.available).toEqual([{ full_name: "some/not-onboarded" }]);
});

test("returns an upstream error when the GitHub fetch fails", async () => {
  const errorServer = createServer((req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream unavailable", code: 503 }));
  });

  await new Promise<void>((resolve) => {
    errorServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = errorServer.address() as any;

  process.env.LORE_API_URL = `http://127.0.0.1:${address.port}`;

  const response = await GET();

  expect(response.status).toBe(503);

  errorServer.close();
  process.env.LORE_API_URL = url;
});
