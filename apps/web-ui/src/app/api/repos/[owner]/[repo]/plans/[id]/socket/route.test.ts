// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const session = vi.fn();
const canAccess = vi.fn();

vi.mock("@/lib/session", () => ({ getSession: () => session() }));
vi.mock("@/lib/user-repo-access", () => ({
  userCanAccessRepo: () => canAccess(),
}));

const { GET } = await import("./route");

const ANA = { login: "ana", user: { name: "Ana" }, accessToken: "gho_x" };

let fetchMock: ReturnType<typeof vi.fn>;

const askSocket = async () => {
  const res = await GET(new Request("http://ui/api/socket"), {
    params: Promise.resolve({ owner: "acme", repo: "shop", id: "p1" }),
  });

  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    body: (await res.json()) as unknown,
  };
};

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  session.mockResolvedValue(ANA);
  canAccess.mockResolvedValue(true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("GET /api/repos/{owner}/{repo}/plans/{id}/socket", () => {
  it("hands ana a token minted for plan p1 and the plan's document name, uncached", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ token: "t1", documentName: "plan:acme/shop:p1" }),
        { status: 200 },
      ),
    );

    expect(await askSocket()).toEqual({
      status: 200,
      cache: "no-store",
      body: { token: "t1", documentName: "plan:acme/shop:p1" },
    });
  });

  it("mints nothing and answers 403 for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      ...(await askSocket()),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      status: 403,
      cache: "no-store",
      body: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });

  it("answers 400 and mints nothing for a plan id that climbs out of its repo's path", async () => {
    const res = await GET(new Request("http://ui/api/socket"), {
      params: Promise.resolve({
        owner: "acme",
        repo: "shop",
        id: "../../../other/repo/plans/p9",
      }),
    });

    expect({
      status: res.status,
      body: (await res.json()) as unknown,
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      status: 400,
      body: { error: "Not a plan of a repository." },
      fetched: 0,
    });
  });

  it("answers 403 asking a visitor without a session to sign in", async () => {
    session.mockResolvedValue(null);

    expect(await askSocket()).toEqual({
      status: 403,
      cache: "no-store",
      body: { error: "Sign in to open this plan." },
    });
  });
});
