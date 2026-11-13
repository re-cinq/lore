// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("./plan-run-facts", () => ({ planRunFor: async () => null }));

const { default: PlanDetailPage } = await import("./PlanDetailPage");

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
