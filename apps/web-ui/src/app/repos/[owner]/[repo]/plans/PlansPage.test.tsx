// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { default: PlansPage } = await import("./PlansPage");

const PLAN = {
  id: "p1",
  title: "Faster checkout",
  type: "feature",
  status: "draft",
  version: 1,
  createdBy: "gedaiu",
  updatedAt: "",
};

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("PlansPage", () => {
  it("hands the list view the plans lore-api lists for re-cinq/lore", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ plans: [PLAN] }))),
    );
    const page = await PlansPage({
      params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
    });

    expect(page.props).toEqual({
      base: "/repos/re-cinq/lore/plans",
      plans: [PLAN],
    });
  });

  it("shows the failure instead of an empty plan list when lore-api errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "db unavailable" }), {
            status: 503,
          }),
      ),
    );
    const page = await PlansPage({
      params: Promise.resolve({ owner: "re-cinq", repo: "otto" }),
    });

    expect(page.props).toEqual({
      message: "Couldn't load plans: db unavailable",
    });
  });

  it("shows an unconfigured message rather than an empty plan list when lore-api has no admin token", async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ plans: [PLAN] }))),
    );
    const page = await PlansPage({
      params: Promise.resolve({ owner: "re-cinq", repo: "otto" }),
    });

    expect(page.props).toEqual({
      message: "Plans are unavailable: lore-api isn't configured.",
    });
  });
});
