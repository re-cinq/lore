// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  getSession: async () => ({ login: "gedaiu", user: { name: "Bogdan" } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { createPlanAction } = await import("./actions");

let fetchMock: ReturnType<typeof vi.fn>;

const form = (fields: Record<string, string>) => {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));

  return formData;
};

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPlanAction", () => {
  it("returns the seed failure and creates nothing else when seeding the plan fails", async () => {
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);

      if (urlStr.includes("/agent-edits")) {
        return new Response(JSON.stringify({ error: "Seed failed" }), {
          status: 500,
        });
      }

      return new Response(
        JSON.stringify({
          meta: { id: "p1" },
          documentName: "plan:re-cinq/lore:p1",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlanAction(
      "re-cinq/lore",
      null,
      form({
        title: "Faster checkout",
        type: "feature",
        description: "Checkout is slow.",
      }),
    );

    expect(result).toEqual({ error: "Seed failed" });
  });

  it("returns the drafting start failure and creates nothing else when starting the draft fails", async () => {
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);

      if (urlStr.includes("/drafting")) {
        return new Response(JSON.stringify({ error: "Drafting failed" }), {
          status: 500,
        });
      }

      return new Response(
        JSON.stringify({
          meta: { id: "p1" },
          documentName: "plan:re-cinq/lore:p1",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlanAction(
      "re-cinq/lore",
      null,
      form({
        title: "Faster checkout",
        type: "feature",
        description: "Checkout is slow.",
      }),
    );

    expect(result).toEqual({ error: "Drafting failed" });
  });
});
