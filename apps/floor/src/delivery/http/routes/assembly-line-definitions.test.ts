import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { registerBearerAuth } from "../auth.js";
import { assemblyLineDefinitionsRoute } from "./assembly-line-definitions.js";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
});

function definitionsServer(load = loadBuiltinAssemblyLines) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(assemblyLineDefinitionsRoute(load));

  return server;
}

describe("GET /api/assembly-line-definitions/{name}", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await definitionsServer().inject({
      method: "GET",
      url: "/api/assembly-line-definitions/implementation",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns the parsed implementation definition including its self-loop edge", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await definitionsServer().inject({
      method: "GET",
      url: "/api/assembly-line-definitions/implementation",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      name: string;
      nodes: { id: string }[];
      edges: { from: string; to: string; iteration_max?: number }[];
    };

    expect(body.name).toBe("implementation");
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(
      body.edges.some(
        (e) => e.from === e.to || typeof e.iteration_max === "number",
      ),
    ).toBe(true);
  });

  it("returns description and version alongside nodes and edges", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await definitionsServer().inject({
      method: "GET",
      url: "/api/assembly-line-definitions/implementation",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(JSON.parse(res.payload)).toMatchObject({
      name: "implementation",
      version: 1,
      description: expect.any(String) as unknown as string,
      entry: expect.any(String) as unknown as string,
      exit: expect.any(String) as unknown as string,
    });
  });

  it("returns 404 for an unknown definition name", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await definitionsServer().inject({
      method: "GET",
      url: "/api/assembly-line-definitions/no-such-line",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("delegates every request to the loader — caching is the loader's job", async () => {
    // loadBuiltinAssemblyLines memoizes its own promise (the one cache; see
    // builtin-assembly-lines.test.ts), so the route holding a second one would
    // only hide the first going stale.
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const load = vi.fn(loadBuiltinAssemblyLines);
    const server = definitionsServer(load);
    const request = () =>
      server.inject({
        method: "GET",
        url: "/api/assembly-line-definitions/implementation",
        headers: { authorization: "Bearer ingest-secret" },
      });

    await Promise.all([request(), request()]);
    await request();

    expect(load).toHaveBeenCalledTimes(3);
  });
});
