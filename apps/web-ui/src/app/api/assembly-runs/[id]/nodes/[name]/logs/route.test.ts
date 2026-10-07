// @vitest-environment node

import { it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const fetchAssemblyRunNodes = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({
  fetchAssemblyRun,
  fetchAssemblyRunNodes,
}));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET } = await import("./route");

const params = Promise.resolve({ id: "run-1", name: "cr-implement" });

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  fetchAssemblyRunNodes.mockResolvedValue([{ agentCrName: "cr-implement" }]);
  userCanAccessRepo.mockResolvedValue(true);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ available: true, logs: "" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("surfaces an upstream 401 as 502 so it cannot masquerade as the proxy's own auth ladder", async () => {
  authorized();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "bad token" }), { status: 401 }),
  );

  const res = await GET(new Request("http://ui/x"), { params });

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "bad token" });
});

it("surfaces an upstream 403 as 502 so NodeLogPanel does not render access denied for an authorized viewer", async () => {
  authorized();
  fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));

  const res = await GET(new Request("http://ui/x"), { params });

  expect(res.status).toBe(502);
});

it("passes a non-auth upstream error like 500 through unchanged", async () => {
  authorized();
  fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

  const res = await GET(new Request("http://ui/x"), { params });

  expect(res.status).toBe(500);
});

it("returns 403 when the user cannot access the run repo", async () => {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "other/repo" });
  userCanAccessRepo.mockResolvedValue(false);

  const res = await GET(new Request("http://ui/x"), { params });

  expect(res.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("requests the node's log on lore-api under the run and the node's name, with the tail", async () => {
  authorized();

  await GET(new Request("http://ui/x?tail=50"), { params });

  expect(fetchMock.mock.calls[0][0]).toBe(
    "http://api:3000/api/assembly-runs/run-1/nodes/cr-implement/logs?tail=50",
  );
});

it("returns the upstream status and body verbatim on success", async () => {
  authorized();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ available: true, logs: "line" }), {
      status: 200,
    }),
  );

  const res = await GET(new Request("http://ui/x"), { params });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ available: true, logs: "line" });
});
