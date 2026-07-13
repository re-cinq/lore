import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { AgentDefsHttp } from "./agent-defs-http.js";
import type { AgentDefinition } from "./agent-defs-port.js";

/**
 * AgentDefsHttp fetches the agent-definitions API — driven against a REAL local HTTP server
 * (no fetch mock). resolve returns the parsed def, 404 → null, and writes throw.
 */

const general: AgentDefinition = {
  name: "general",
  model: "claude-haiku-4-5-20251001",
  timeout_minutes: 30,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  project_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
};

let server: Server;
let baseUrl: string;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.headers.authorization ?? "-"} ${req.url}`);
    res.setHeader("content-type", "application/json");

    if (req.url === "/api/repos/re-cinq/re-plan/agent-definitions/general") {
      res.end(JSON.stringify(general));
    } else if (req.url === "/api/repos/re-cinq/re-plan/agent-definitions") {
      res.end(JSON.stringify({ agents: [general] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("AgentDefsHttp", () => {
  it("resolves an agent by fetching the API with the bearer token", async () => {
    const store = new AgentDefsHttp(baseUrl, "tok-123");

    expect(await store.resolve("re-cinq/re-plan", "general")).toEqual(general);
    expect(seen).toContain(
      "Bearer tok-123 /api/repos/re-cinq/re-plan/agent-definitions/general",
    );
  });

  it("returns null on a 404", async () => {
    expect(
      await new AgentDefsHttp(baseUrl).resolve("re-cinq/re-plan", "missing"),
    ).toBeNull();
  });

  it("lists agents from the resource envelope", async () => {
    expect(
      (await new AgentDefsHttp(baseUrl).list("re-cinq/re-plan")).map(
        (a) => a.name,
      ),
    ).toEqual(["general"]);
  });

  it("refuses writes from a runner", async () => {
    await expect(
      new AgentDefsHttp(baseUrl).delete("re-cinq/re-plan", "general"),
    ).rejects.toThrow(/read-only from a runner/);
  });
});
