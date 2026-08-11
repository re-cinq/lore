// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyLineRun = vi.fn();
const userCanWriteRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-line-runs", () => ({ fetchAssemblyLineRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanWriteRepo }));

const { POST, dynamic } = await import("./route");

const params = Promise.resolve({ id: "run-1" });

function postRequest(nodeId = "review") {
  const form = new FormData();

  form.set("node_id", nodeId);

  return new Request("http://ui/api/assembly-lines/run-1/rerun", {
    method: "POST",
    body: form,
  });
}

function authorized() {
  getServerSession.mockResolvedValue({
    accessToken: "gho_x",
    user: { name: "loredana" },
  });
  fetchAssemblyLineRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanWriteRepo.mockResolvedValue(true);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_FLOOR_URL = "http://floor:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ started: "run-2" }), { status: 202 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("exports dynamic force-dynamic", () => {
  expect(dynamic).toBe("force-dynamic");
});

describe("auth ladder", () => {
  it("returns 401 without a session access token", async () => {
    getServerSession.mockResolvedValue(null);

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the run does not exist", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyLineRun.mockResolvedValue(null);

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks write access to the run's repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyLineRun.mockResolvedValue({
      id: "run-1",
      repo: "re-cinq/public",
    });
    userCanWriteRepo.mockResolvedValue(false);

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("forwarding", () => {
  it("returns 400 when node_id is missing", async () => {
    authorized();

    const form = new FormData();
    const res = await POST(
      new Request("http://ui/api/assembly-lines/run-1/rerun", {
        method: "POST",
        body: form,
      }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards node_id and the session actor to the Floor with the ingest bearer", async () => {
    authorized();

    await POST(postRequest("review"), { params });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://floor:3000/api/assembly-lines/run-1/rerun",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        body: JSON.stringify({ node_id: "review", actor: "loredana" }),
      }),
    );
  });

  it("returns the fork's line id on success", async () => {
    authorized();

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: "run-2" });
  });

  it("passes a Floor refusal through as 409 with the upstream message", async () => {
    authorized();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "definition hash mismatch" }), {
        status: 409,
      }),
    );

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "definition hash mismatch" });
  });

  it("maps any other Floor failure to 502 without echoing its body", async () => {
    authorized();
    fetchMock.mockResolvedValue(
      new Response("stack trace soup", { status: 500 }),
    );

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Floor returned 500" });
  });
});
