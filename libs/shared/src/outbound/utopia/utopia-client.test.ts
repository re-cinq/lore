import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { enforceTrue } from "../../lib/enforce.js";
import {
  UtopiaError,
  utopiaClientFrom,
  utopiaAutoSetupConfigured,
  utopiaConfigured,
} from "./utopia-client.js";
import { tombstone } from "../../domain/utopia/statements.js";

interface Seen {
  method: string;
  url: string;
  authorization: string;
  contentType: string;
  body: string;
}

const seen: Seen[] = [];
let failPushesLeft = 0;
let server: Server;
let baseUrl: string;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";

    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });

const ROUTES: Record<string, (body: string) => [number, unknown]> = {
  "POST /api/v1/sources/src-1/statements": (body) =>
    JSON.parse(body).deleted
      ? [200, { action: "marked_missing" }]
      : [200, { action: "created" }],
  "POST /api/v1/sources/src-422/statements": () => [
    422,
    { error: "x".repeat(400) },
  ],
  "GET /api/v1/workspaces/ws-1/kbs": () => [
    200,
    [{ id: "kb-1", name: "re-cinq/lore" }],
  ],
  "POST /api/v1/workspaces/ws-1/kbs": (body) => [
    201,
    { id: "kb-2", name: JSON.parse(body).name },
  ],
  "POST /api/v1/kbs/kb-1/ontology/imports": () => [
    200,
    { import_id: "imp-1", plan: {} },
  ],
  "POST /api/v1/kbs/kb-1/review/alignment/kind-words/Statement": () => [
    200,
    { ok: true },
  ],
  "POST /api/v1/kbs/kb-1/sources": () => [
    201,
    { ingest_token: "utp_secret", source: { id: "src-9" } },
  ],
};

const answerOf = (req: IncomingMessage, body: string): [number, unknown] => {
  if (failPushesLeft > 0 && req.url?.endsWith("/statements")) {
    failPushesLeft -= 1;

    return [503, { error: "busy" }];
  }
  const route = ROUTES[`${req.method} ${req.url}`];

  return route ? route(body) : [404, { error: "none" }];
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);

    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: String(req.headers.authorization ?? ""),
      contentType: String(req.headers["content-type"] ?? ""),
      body,
    });
    const [status, payload] = answerOf(req, body);

    res.setHeader("content-type", "application/json");
    res.statusCode = status;
    res.end(JSON.stringify(payload));
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

beforeEach(() => {
  seen.length = 0;
  failPushesLeft = 0;
});

const client = () =>
  utopiaClientFrom({ UTOPIA_API_URL: baseUrl }, { retryDelayMs: 1 });

const PUSH = {
  externalId: "doc:specs/x/spec.md",
  doc_time: "2026-10-15T10:00:00Z",
  e: [["re-cinq/lore", "Repository", true] as const],
  s: [],
};

describe("utopiaConfigured", () => {
  it("is true with UTOPIA_API_URL set and false without it", () => {
    expect([
      utopiaConfigured({ UTOPIA_API_URL: baseUrl }),
      utopiaConfigured({}),
    ]).toEqual([true, false]);
  });
});

describe("utopiaAutoSetupConfigured", () => {
  it("is true with the URL, the token and the workspace id set, and false when any one of them is missing", () => {
    const all = {
      UTOPIA_API_URL: baseUrl,
      UTOPIA_TOKEN: "utp_pat_1",
      UTOPIA_WORKSPACE_ID: "ws-1",
    };

    expect([
      utopiaAutoSetupConfigured(all),
      utopiaAutoSetupConfigured({ ...all, UTOPIA_API_URL: "" }),
      utopiaAutoSetupConfigured({ ...all, UTOPIA_TOKEN: undefined }),
      utopiaAutoSetupConfigured({ ...all, UTOPIA_WORKSPACE_ID: "" }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("pushStatements", () => {
  it("posts the item under the source key with external_id, doc_time and an empty notes list, and returns the action", async () => {
    const outcome = await client().pushStatements(
      { id: "src-1", key: "utp_key" },
      { ...PUSH, e: [["re-cinq/lore", "Repository", true]] },
    );

    expect({ outcome, seen }).toEqual({
      outcome: { action: "created" },
      seen: [
        {
          method: "POST",
          url: "/api/v1/sources/src-1/statements",
          authorization: "Bearer utp_key",
          contentType: "application/json",
          body: JSON.stringify({
            external_id: "doc:specs/x/spec.md",
            doc_time: "2026-10-15T10:00:00Z",
            e: [["re-cinq/lore", "Repository", true]],
            s: [],
            n: [],
          }),
        },
      ],
    });
  });

  it("posts a tombstone as external_id plus deleted true and returns marked_missing", async () => {
    const outcome = await client().pushStatements(
      { id: "src-1", key: "utp_key" },
      tombstone("doc:specs/x/spec.md"),
    );

    expect({ outcome, body: seen[0].body }).toEqual({
      outcome: { action: "marked_missing" },
      body: JSON.stringify({
        external_id: "doc:specs/x/spec.md",
        deleted: true,
      }),
    });
  });

  it("retries once after a 503 and returns the second answer", async () => {
    failPushesLeft = 1;
    const outcome = await client().pushStatements(
      { id: "src-1", key: "utp_key" },
      tombstone("doc:specs/x/spec.md"),
    );

    expect({ outcome, requests: seen.length }).toEqual({
      outcome: { action: "marked_missing" },
      requests: 2,
    });
  });

  it("gives up after two 503s with a UtopiaError carrying the status", async () => {
    failPushesLeft = 2;

    await expect(
      client().pushStatements(
        { id: "src-1", key: "utp_key" },
        tombstone("doc:specs/x/spec.md"),
      ),
    ).rejects.toMatchObject({ name: "UtopiaError", status: 503 });
  });

  it("throws a UtopiaError with the status and the first 300 body characters on a 422 without retrying", async () => {
    const failure = await client()
      .pushStatements({ id: "src-422", key: "utp_key" }, tombstone("doc:x"))
      .catch((error: unknown) => error);

    expect({
      instance: failure instanceof UtopiaError,
      status: (failure as UtopiaError).status,
      bodyLength: (failure as UtopiaError).body.length,
      requests: seen.length,
    }).toEqual({ instance: true, status: 422, bodyLength: 300, requests: 1 });
  });
});

describe("withCredential", () => {
  it("lists a workspace's knowledge bases under the session token", async () => {
    const kbs = await client()
      .withCredential("jwt-1")
      .listKnowledgeBases("ws-1");

    expect({ kbs, authorization: seen[0].authorization }).toEqual({
      kbs: [{ id: "kb-1", name: "re-cinq/lore" }],
      authorization: "Bearer jwt-1",
    });
  });

  it("sends a utp_pat_1 write token as the bearer of the same request", async () => {
    await client().withCredential("utp_pat_1").listKnowledgeBases("ws-1");

    expect(seen[0]).toMatchObject({
      method: "GET",
      url: "/api/v1/workspaces/ws-1/kbs",
      authorization: "Bearer utp_pat_1",
    });
  });

  it("creates a knowledge base of kind knowledge with no ontology packs", async () => {
    const kb = await client()
      .withCredential("jwt-1")
      .createKnowledgeBase("ws-1", "re-cinq/lore");

    expect({ kb, body: JSON.parse(seen[0].body) }).toEqual({
      kb: { id: "kb-2", name: "re-cinq/lore" },
      body: { name: "re-cinq/lore", kind: "knowledge", ontology_packs: [] },
    });
  });

  it("imports the ontology as a multipart turtle file named lore-ontology.ttl", async () => {
    const imported = await client()
      .withCredential("jwt-1")
      .importOntology("kb-1", "@prefix lore: <x> .", "lore-ontology.ttl");

    expect({
      imported,
      multipart: seen[0].contentType.startsWith("multipart/form-data"),
      filename: seen[0].body.includes('filename="lore-ontology.ttl"'),
      turtle: seen[0].body.includes("@prefix lore: <x> ."),
      type: seen[0].body.includes("Content-Type: text/turtle"),
    }).toEqual({
      imported: { importId: "imp-1" },
      multipart: true,
      filename: true,
      turtle: true,
      type: true,
    });
  });

  it("binds a kind word to its class key", async () => {
    await client()
      .withCredential("jwt-1")
      .bindKindWord("kb-1", "Statement", "statement");

    expect(seen[0]).toMatchObject({
      url: "/api/v1/kbs/kb-1/review/alignment/kind-words/Statement",
      body: JSON.stringify({ class: "statement" }),
    });
  });

  it("creates a statements source and returns its id with the ingest token as the key", async () => {
    const source = await client()
      .withCredential("jwt-1")
      .createStatementsSource("kb-1", "lore");

    expect({ source, body: JSON.parse(seen[0].body) }).toEqual({
      source: { id: "src-9", key: "utp_secret" },
      body: { kind: "statements", name: "lore", config: {} },
    });
  });
});
