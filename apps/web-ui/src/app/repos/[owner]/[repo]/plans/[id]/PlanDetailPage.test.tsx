// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));

const { default: PlanDetailPage } = await import("./PlanDetailPage");

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
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
