// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getGraphBrowse,
  listPools,
  getPool,
  listEpisodes,
  listMemories,
  searchMemory,
} = await import("./memory");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const url = () => String(fetchMock.mock.calls[0][0]);

describe("getGraphBrowse", () => {
  it("asks for the browse payload with no filters", async () => {
    await getGraphBrowse({});

    expect(url()).toEqual("http://api:3000/api/graph-browse?");
  });

  it("carries the selected entity, the type filter and the invalid flag", async () => {
    await getGraphBrowse({
      entity: "lore-api",
      type: "service",
      showInvalid: true,
    });

    expect(url()).toContain("entity=lore-api");
    expect(url()).toContain("type=service");
    expect(url()).toContain("show_invalid=true");
  });

  it("omits the invalid flag when it is not set", async () => {
    await getGraphBrowse({ entity: "lore-api" });

    expect(url()).not.toContain("show_invalid");
  });

  it("returns the payload on 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stats: { entity_count: 3 } })),
    );

    expect(await getGraphBrowse({})).toMatchObject({
      status: "ok",
      data: { stats: { entity_count: 3 } },
    });
  });
});

describe("listPools", () => {
  it("reads the pool list", async () => {
    await listPools();

    expect(url()).toEqual("http://api:3000/api/pools");
  });
});

describe("getPool", () => {
  it("encodes the pool name", async () => {
    await getPool("team/platform");

    expect(url()).toEqual("http://api:3000/api/pools/team%2Fplatform");
  });

  it("reports an unknown pool as a 404 result rather than throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Pool not found" }), {
        status: 404,
      }),
    );

    expect(await getPool("nope")).toMatchObject({
      status: "error",
      code: 404,
    });
  });
});

describe("listEpisodes", () => {
  it("defaults the page to 50 from the start", async () => {
    await listEpisodes({});

    expect(url()).toContain("limit=50");
    expect(url()).toContain("offset=0");
  });

  it("carries the source and agent filters and the requested page", async () => {
    await listEpisodes({
      source: "session",
      agent: "klaus",
      limit: 30,
      offset: 60,
    });

    expect(url()).toContain("source=session");
    expect(url()).toContain("agent=klaus");
    expect(url()).toContain("limit=30");
    expect(url()).toContain("offset=60");
  });
});

describe("listMemories", () => {
  it("reads an agent's memories, defaulting to 100", async () => {
    await listMemories("klaus");

    expect(url()).toContain("agent=klaus");
    expect(url()).toContain("limit=100");
  });

  it("honours a smaller limit", async () => {
    await listMemories("klaus-gap-detection", 10);

    expect(url()).toContain("limit=10");
  });
});

describe("searchMemory", () => {
  it("encodes the query text", async () => {
    await searchMemory("cache invalidation");

    expect(url()).toEqual(
      "http://api:3000/api/memory-search?q=cache%20invalidation",
    );
  });
});
