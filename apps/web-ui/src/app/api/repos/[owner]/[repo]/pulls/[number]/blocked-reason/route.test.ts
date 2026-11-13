// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sessionToken = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("@/lib/session-token", () => ({ sessionToken }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({
  owner: "re-cinq",
  repo: "lore",
  number: "42",
});

function authorized() {
  sessionToken.mockResolvedValue("tok");
  userCanAccessRepo.mockResolvedValue(true);
}

const upstreamBody = JSON.stringify({
  repo: "re-cinq/lore",
  prNumber: 42,
  reason: "ci_pending",
  label: "Waiting for CI",
  detail: null,
  since: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:00:00.000Z",
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(upstreamBody, { status: 200 }));
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
    sessionToken.mockResolvedValue(null);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot access the repo", async () => {
    sessionToken.mockResolvedValue("tok");
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upstream proxying", () => {
  it("requests /api/repos/re-cinq/lore/pulls/42/blocked-reason on lore-api with the bearer token", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/pulls/42/blocked-reason",
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer tok",
    });
  });

  it("passes the upstream body through as JSON", async () => {
    authorized();

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.text()).toBe(upstreamBody);
  });
});
