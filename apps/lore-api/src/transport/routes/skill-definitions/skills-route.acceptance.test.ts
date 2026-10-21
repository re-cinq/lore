import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const BASE = "/api/skill-definitions";
const originalEnv = { ...process.env };

describe("routes — skills", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function call(
    url: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: unknown,
    {
      headers = {},
      pool = makePool(),
    }: {
      headers?: Record<string, string>;
      pool?: ReturnType<typeof makePool>;
    } = {},
  ) {
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return buildServer(() => pool as any)
      .inject({ method, url, headers: { ...AUTH, ...headers }, payload })
      .then((res) => ({ res, pool }));
  }

  describe("GET", () => {
    it("lists org-level skill definitions", async () => {
      const { res } = await call(BASE, "GET");
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toHaveProperty("skills");
    });
  });

  describe("writes", () => {
    it("creates a skill definition (admin tier)", async () => {
      const { res } = await call(BASE, "POST", {
        name: "test-skill",
        title: "Test Skill",
        description: "A test skill",
        content: "<!-- lore-help:begin -->Help<!-- lore-help:end -->",
        enabled: true,
      });

      expect(res.statusCode).toBe(200);
    });

    it("updates a skill definition", async () => {
      const { res } = await call(`${BASE}/test-skill`, "PUT", {
        title: "Updated Title",
      });

      expect(res.statusCode).toBe(200);
    });

    it("deletes a skill definition", async () => {
      const { res } = await call(`${BASE}/test-skill`, "DELETE");

      expect(res.statusCode).toBe(200);
    });
  });
});
