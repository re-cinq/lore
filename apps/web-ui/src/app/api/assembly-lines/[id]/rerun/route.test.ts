// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyLineRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-line-runs", () => ({ fetchAssemblyLineRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { POST, dynamic } = await import("./route");

const params = Promise.resolve({ id: "run-1" });

function postRequest(nodeId = "review") {
  const form = new FormData();

  form.set("node_id", nodeId);

  return new Request("http://ui/api/assembly-lines/run-1/rerun", {
    method: "POST",
    body: form,
    headers: { referer: "http://ui/assembly-lines/run-1" },
  });
}

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyLineRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
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

  it("returns 403 when the user cannot access the run's repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyLineRun.mockResolvedValue({
      id: "run-1",
      repo: "re-cinq/private",
    });
    userCanAccessRepo.mockResolvedValue(false);

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

  it("forwards node_id to the Floor rerun endpoint with the ingest bearer", async () => {
    authorized();

    await POST(postRequest("review"), { params });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://floor:3000/api/assembly-lines/run-1/rerun",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        body: JSON.stringify({ node_id: "review" }),
      }),
    );
  });

  it("redirects to the new fork's run page on success", async () => {
    authorized();

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://ui/assembly-lines/run-2");
  });

  it("surfaces a Floor refusal as 502 with the upstream message", async () => {
    authorized();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "definition hash mismatch" }), {
        status: 409,
      }),
    );

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("definition hash mismatch"),
    });
  });
});
