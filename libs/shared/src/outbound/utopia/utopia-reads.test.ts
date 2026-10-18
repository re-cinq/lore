import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { enforceTrue } from "../../lib/enforce.js";
import { UtopiaError } from "./utopia-client.js";
import { utopiaReadsFrom, type UtopiaReads } from "./utopia-reads.js";

interface Seen {
  method: string;
  url: string;
  authorization: string;
  body: string;
}

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../domain/utopia/fixtures/${name}`, import.meta.url),
    "utf-8",
  );

const BY_EXTERNAL_ID =
  "/api/v1/kbs/kb-1/sources/src-1/documents/by-external-id?external_id=";

const ROUTES: Record<string, (body: string) => [number, string]> = {
  "POST /api/v1/kbs/kb-1/search": (body) =>
    JSON.parse(body).offset + JSON.parse(body).top_k > 100
      ? [
          422,
          '{"error":"offset + top_k may not exceed 100","code":"page_too_deep"}',
        ]
      : [200, fixture("search-page.json")],
  [`GET ${BY_EXTERNAL_ID}stmt%3Aspecs%2Futopia-graph-mirror%2Fspec.md%230003`]:
    () => [200, fixture("stored-document.json")],
};

const seen: Seen[] = [];
let server: Server;
let reads: UtopiaReads;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";

    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);

    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: String(req.headers.authorization ?? ""),
      body,
    });
    const route = ROUTES[`${req.method} ${req.url}`];
    const [status, payload] = route
      ? route(body)
      : [404, '{"error":"Not found"}'];

    res.setHeader("content-type", "application/json");
    res.statusCode = status;
    res.end(payload);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );
  const configured = utopiaReadsFrom(
    {
      UTOPIA_API_URL: `http://127.0.0.1:${addr.port}/`,
      UTOPIA_TOKEN: "utp_pat_1",
    },
    { retryDelayMs: 1 },
  );

  enforceTrue(configured, Error, "reads not configured");
  reads = configured;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  seen.length = 0;
});

describe("utopiaReadsFrom", () => {
  it("returns null when the URL or the token is unset", () => {
    expect([
      utopiaReadsFrom({ UTOPIA_TOKEN: "utp_pat_1" }),
      utopiaReadsFrom({ UTOPIA_API_URL: "http://utopia" }),
    ]).toEqual([null, null]);
  });
});

describe("search", () => {
  it("posts q, top_k 50 and offset 0 to /api/v1/kbs/kb-1/search with the PAT", async () => {
    const page = await reads.search("kb-1", "retry a 422", {
      topK: 50,
      offset: 0,
    });

    expect({
      seen,
      externalIds: page.hits.map((hit) => hit.externalId),
    }).toEqual({
      seen: [
        {
          method: "POST",
          url: "/api/v1/kbs/kb-1/search",
          authorization: "Bearer utp_pat_1",
          body: '{"q":"retry a 422","top_k":50,"offset":0}',
        },
      ],
      externalIds: ["stmt:specs/utopia-graph-mirror/spec.md#0003.2", null],
    });
  });

  it("posts source_id src-1 and the prefixes doc: and stmt: when the search is scoped to them", async () => {
    await reads.search("kb-1", "retry a 422", {
      topK: 50,
      offset: 0,
      scope: { sourceId: "src-1", externalIdPrefixes: ["doc:", "stmt:"] },
    });

    expect(JSON.parse(seen[0]?.body ?? "")).toEqual({
      q: "retry a 422",
      top_k: 50,
      offset: 0,
      source_id: "src-1",
      external_id_prefixes: ["doc:", "stmt:"],
    });
  });

  it("throws on a 422 page_too_deep without retrying", async () => {
    const failure = await reads
      .search("kb-1", "retry", { topK: 50, offset: 60 })
      .catch((error: unknown) => error);

    expect({
      instance: failure instanceof UtopiaError,
      status: (failure as UtopiaError).status,
      requests: seen.length,
    }).toEqual({ instance: true, status: 422, requests: 1 });
  });
});

describe("documentByExternalId", () => {
  it("returns the stored stmt:specs/utopia-graph-mirror/spec.md#0003 at version 2, its id encoded into the query", async () => {
    const document = await reads.documentByExternalId(
      "kb-1",
      "src-1",
      "stmt:specs/utopia-graph-mirror/spec.md#0003",
    );

    expect({ id: document?.externalId, version: document?.version }).toEqual({
      id: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      version: 2,
    });
  });

  it("returns null on a 404 from by-external-id", async () => {
    expect(
      await reads.documentByExternalId("kb-1", "src-1", "stmt:gone.md#0001"),
    ).toBe(null);
  });
});
