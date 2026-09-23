// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session-access-token", () => ({
  resolveSessionAccessToken: async () => "gho_x",
}));
vi.mock("@/lib/session", () => ({
  getSession: async () => ({ login: "gedaiu", user: { name: "Bogdan" } }),
}));
vi.mock("@/lib/user-repo-access", () => ({
  userCanAccessRepo: async () => true,
}));

const { POST } = await import("./route");

let fetchMock: ReturnType<typeof vi.fn>;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "ingest";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_INGEST_TOKEN;
});

function post(fields: Record<string, string>) {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }

  return POST(
    new Request("http://ui/api/assembly-runs/run-station", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/assembly-runs/run-station", () => {
  it("resolves run-1's repo, then asks lore-api to run write in gedaiu's name and answers the fresh id", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          line: { repo: "re-cinq/lore", blueprintName: "feature-planning" },
        }),
      )
      .mockResolvedValueOnce(json(201, { id: "fresh-9" }));

    const res = await post({ run_id: "run-1", node_id: "write" });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect({
      status: res.status,
      body: await res.json(),
      url,
      sent: JSON.parse(String(init.body)) as unknown,
    }).toEqual({
      status: 200,
      body: { id: "fresh-9" },
      url: "http://api:3000/api/assembly-runs/run-1/run-station",
      sent: { node_id: "write", actor: "gedaiu" },
    });
  });

  it("passes lore-api's refusal through with its reason", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          line: { repo: "re-cinq/lore", blueprintName: "feature-planning" },
        }),
      )
      .mockResolvedValueOnce(
        json(409, { error: "another run (r2) is already working plan:p1" }),
      );

    const res = await post({ run_id: "run-1", node_id: "write" });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "another run (r2) is already working plan:p1" },
    });
  });

  it("answers 400 when the form names no node", async () => {
    expect((await post({ run_id: "run-1" })).status).toBe(400);
  });
});
