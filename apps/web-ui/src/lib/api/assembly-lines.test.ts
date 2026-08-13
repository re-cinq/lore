// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getAssemblyLineDefinition } = await import("./assembly-lines");

const definition = {
  name: "feature-planning",
  description: "Plan a feature.",
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [{ id: "analyze", type: "agent" }],
  edges: [{ from: "analyze", to: "done", on: "always" }],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_FLOOR_URL = "http://floor:8080";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(definition), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAssemblyLineDefinition", () => {
  it("returns the definition the Floor serves", async () => {
    expect(await getAssemblyLineDefinition("feature-planning")).toMatchObject({
      name: "feature-planning",
      entry: "analyze",
    });
  });

  it("asks the Floor for the named definition, with the ingest token", async () => {
    await getAssemblyLineDefinition("feature-planning");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://floor:8080/api/assembly-line-definitions/feature-planning",
    );
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
  });

  it("caches for the given window rather than refetching per render", async () => {
    await getAssemblyLineDefinition("feature-planning", 300);

    expect(fetchMock.mock.calls[0][1].next).toEqual({ revalidate: 300 });
  });

  it("returns null when the Floor is not configured", async () => {
    delete process.env.LORE_FLOOR_URL;
    expect(await getAssemblyLineDefinition("feature-planning")).toBeNull();
  });

  it("returns null when there is no ingest token", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    expect(await getAssemblyLineDefinition("feature-planning")).toBeNull();
  });

  it("returns null for a definition the Floor does not have", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await getAssemblyLineDefinition("nope")).toBeNull();
  });

  it("returns null when the Floor is unreachable", async () => {
    // The create form must render whether or not the Floor is up.
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await getAssemblyLineDefinition("feature-planning")).toBeNull();
  });

  it("returns null for a payload carrying no nodes", async () => {
    // An error envelope would otherwise reach the renderer as a shape it does not
    // expect, and a node-less graph cannot be drawn anyway.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 200 }),
    );
    expect(await getAssemblyLineDefinition("feature-planning")).toBeNull();
  });

  it("escapes the name rather than pasting it into the path", async () => {
    await getAssemblyLineDefinition("a/b");

    expect(fetchMock.mock.calls[0][0]).toContain("a%2Fb");
  });
});
