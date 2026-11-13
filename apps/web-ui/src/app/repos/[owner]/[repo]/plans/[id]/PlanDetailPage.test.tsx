// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => vi.fn(async () => null as object | null));

vi.mock("@/lib/session", () => ({ getSession: () => session() }));

const { default: PlanDetailPage } = await import("./PlanDetailPage");

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
});

afterEach(() => {
  vi.unstubAllGlobals();
  session.mockResolvedValue(null);
});

const PLAN = {
  json: {
    schemaVersion: 1,
    id: "p1",
    repo: "re-cinq/lore",
    type: "feature",
    templateVersion: 1,
    title: "Faster checkout",
    status: "draft",
    approval: null,
    version: 2,
    createdBy: "gedaiu",
    updatedAt: "2026-11-06T10:00:00.000Z",
  },
  contentHash: "h",
  version: 2,
};

const STORY_URL = "https://github.com/re-cinq/lore/issues/123";

function loreApi(asked: string[]) {
  return vi.fn(async (url: string | URL) => {
    const { pathname } = new URL(String(url));

    asked.push(pathname);

    return new Response(JSON.stringify(answerFor(pathname)));
  });
}

function answerFor(pathname: string): object {
  if (pathname.endsWith("/collab-token")) {
    return { token: "c1", documentName: "plan:re-cinq/lore:p1" };
  }

  if (pathname.endsWith("/run-stream-token")) {
    return { token: "r1", expires_at: "2026-11-06T10:10:00.000Z" };
  }

  if (pathname.endsWith("/story")) {
    return { issueNumber: 123, issueUrl: STORY_URL };
  }

  return pathname === "/api/auth/access" ? { allowed: true } : PLAN;
}

describe("PlanDetailPage", () => {
  it("answers not found for a plan that belongs to another repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              json: { repo: "acme/shop" },
              contentHash: "h",
              version: 1,
            }),
          ),
      ),
    );

    await expect(
      PlanDetailPage({
        params: Promise.resolve({ owner: "re-cinq", repo: "lore", id: "p1" }),
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("renders plan p1 for gedaiu from the plan, its story, the access check and two tokens, reading no run, visit or PR", async () => {
    const asked: string[] = [];

    session.mockResolvedValue({ login: "gedaiu", user: { name: "Bogdan" } });
    vi.stubGlobal("fetch", loreApi(asked));
    await PlanDetailPage({
      params: Promise.resolve({ owner: "re-cinq", repo: "lore", id: "p1" }),
    });

    expect(asked.sort()).toEqual([
      "/api/auth/access",
      "/api/plans/p1",
      "/api/plans/p1/story",
      "/api/repos/re-cinq/lore/plans/p1/collab-token",
      "/api/repos/re-cinq/lore/plans/p1/run-stream-token",
    ]);
  });

  it("mints no token for a plan that belongs to another repo", async () => {
    const asked: string[] = [];

    session.mockResolvedValue({ login: "gedaiu", user: { name: "Bogdan" } });
    vi.stubGlobal("fetch", loreApi(asked));

    await expect(
      PlanDetailPage({
        params: Promise.resolve({ owner: "acme", repo: "shop", id: "p1" }),
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(asked.sort()).toEqual(["/api/plans/p1", "/api/plans/p1/story"]);
  });
});

const META = {
  schemaVersion: 1,
  id: "p1",
  repo: "re-cinq/lore",
  type: "feature",
  templateVersion: 1,
  title: "Faster checkout",
  status: "draft",
  approval: null,
  version: 2,
  createdBy: "gedaiu",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

const answerPlanWithStory = (story: Response) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/story")
        ? story
        : new Response(
            JSON.stringify({ json: META, contentHash: "h", version: 2 }),
          ),
    ),
  );

const renderPage = async () =>
  (await PlanDetailPage({
    params: Promise.resolve({ owner: "re-cinq", repo: "lore", id: "p1" }),
  })) as { props: { story: unknown } };

describe("PlanDetailPage user story", () => {
  it("hands the view story #123 read from lore-api", async () => {
    const story = {
      issueNumber: 123,
      issueUrl: "https://github.com/re-cinq/lore/issues/123",
    };

    answerPlanWithStory(new Response(JSON.stringify(story)));

    expect((await renderPage()).props.story).toEqual(story);
  });

  it("hands the view no story when lore-api cannot read it", async () => {
    answerPlanWithStory(new Response("{}", { status: 500 }));

    expect((await renderPage()).props.story).toBeNull();
  });
});
