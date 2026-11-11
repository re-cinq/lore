import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  makeOctokit,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/two-key/approval-pr.js", () => {
  class TwoKeyError extends Error {
    constructor(
      message: string,
      public readonly code: string,
    ) {
      super(message);
    }
  }

  return { verifyApproval: vi.fn(), TwoKeyError };
});
vi.mock("../../../outbound/github-client.js", () => ({
  getOctokit: vi.fn(),
  getGitHubToken: vi.fn(),
}));

const fakeAgents = {
  resolve: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({
    agentDefs: fakeAgents,
    agentDefsWriter: fakeAgents,
  })),
}));

import {
  verifyApproval,
  TwoKeyError,
} from "../../../work/two-key/approval-pr.js";
import { getOctokit } from "../../../outbound/github-client.js";

const BASE = "/api/repos/o/r/agent-definitions";
const originalEnv = { ...process.env };

const def = {
  name: "general",
  model: "claude-opus-4-8",
  timeout_minutes: 45,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  project_id: "p1",
};

describe("routes — agents", () => {
  useRateLimitSafeClock();
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
    pool.query.mockResolvedValue({});
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return buildServer(() => pool as any)
      .inject({ method, url, headers: { ...AUTH, ...headers }, payload })
      .then((res) => ({ res, pool }));
  }

  it("returns 503 when the pool is null", async () => {
    const res = await buildServer(() => null).inject({
      method: "GET",
      url: BASE,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(503);
  });

  describe("GET", () => {
    it("lists the repo's resolved agents", async () => {
      fakeAgents.list.mockResolvedValue([def]);
      const { res } = await call(BASE, "GET");

      expect(res.result).toEqual({ agents: [def] });
    });

    it("resolves one agent by name", async () => {
      fakeAgents.resolve.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "GET");

      expect(res.result).toEqual(def);
      expect(fakeAgents.resolve).toHaveBeenCalledWith("general");
    });

    it("returns 404 when the agent does not exist", async () => {
      fakeAgents.resolve.mockResolvedValue(null);
      const { res } = await call(`${BASE}/nope`, "GET");

      expect(res.statusCode).toBe(404);
      expect(res.result).toEqual({
        error: "agent definition not found",
        name: "nope",
      });
    });
  });

  describe("writes", () => {
    it("creates an agent (admin tier) and audits it", async () => {
      fakeAgents.create.mockResolvedValue(def);
      const { res, pool } = await call(BASE, "POST", {
        name: "general",
        model: "claude-opus-4-8",
      });

      expect(res.result).toMatchObject({
        ok: true,
        agent: def,
        ceremony: { tier: "admin" },
      });
      expect(fakeAgents.create).toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("pipeline.audit_log"),
        expect.arrayContaining(["agent_created", "o/r"]),
      );
    });

    it("rejects an invalid body with 400", async () => {
      const { res } = await call(BASE, "POST", { name: "NotKebab" });

      expect(res.statusCode).toBe(400);
      expect((res.result as { error: string }).error).toBe("invalid_agent");
    });

    it("two-key gates a create that sets an image (no approval header)", async () => {
      const { res } = await call(BASE, "POST", {
        name: "custom",
        image: "golang:1.23",
      });

      expect(res.statusCode).toBe(403);
      expect((res.result as { error: string }).error).toBe("two_key_required");
      expect(fakeAgents.create).not.toHaveBeenCalled();
    });

    it("applies an image create after CODEOWNERS approval", async () => {
      fakeAgents.create.mockResolvedValue({
        ...def,
        name: "custom",
        image: "golang:1.23",
      });
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockResolvedValue({
        prRef: "#5",
        approver: "alice",
        prUrl: "https://gh/5",
      } as any);
      const { res } = await call(
        BASE,
        "POST",
        { name: "custom", image: "golang:1.23" },
        { headers: { "x-lore-approval-pr": "#5" } },
      );

      expect(res.result).toMatchObject({
        ok: true,
        ceremony: { tier: "two_key", approver: "alice" },
      });
    });

    it("returns 403 on a CODEOWNERS failure for an image change", async () => {
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(
        new TwoKeyError("nope", "approver_not_codeowner"),
      );
      const { res } = await call(
        BASE,
        "POST",
        { name: "custom", image: "golang:1.23" },
        { headers: { "x-lore-approval-pr": "#5" } },
      );

      expect(res.result).toMatchObject({
        error: "codeowners_check_failed",
        code: "approver_not_codeowner",
      });
    });

    it("updates an agent by name", async () => {
      fakeAgents.update.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "PUT", {
        model: "claude-haiku-4-5-20251001",
      });

      expect(res.result).toMatchObject({ ok: true, agent: def });
      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        { model: "claude-haiku-4-5-20251001" },
        undefined,
      );
    });

    it("two-key gates an update that sets an image (no approval header)", async () => {
      const { res } = await call(`${BASE}/general`, "PUT", {
        image: "golang:1.23",
      });

      expect(res.statusCode).toBe(403);
      expect((res.result as { error: string }).error).toBe("two_key_required");
      expect(fakeAgents.update).not.toHaveBeenCalled();
    });

    it("applies an image update after CODEOWNERS approval", async () => {
      fakeAgents.update.mockResolvedValue({ ...def, image: "golang:1.23" });
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockResolvedValue({
        prRef: "#5",
        approver: "alice",
        prUrl: "https://gh/5",
      } as any);
      const { res } = await call(
        `${BASE}/general`,
        "PUT",
        { image: "golang:1.23" },
        { headers: { "x-lore-approval-pr": "#5" } },
      );

      expect(res.result).toMatchObject({
        ok: true,
        ceremony: { tier: "two_key", approver: "alice" },
      });
    });

    it("returns 403 on a CODEOWNERS failure for an image update", async () => {
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(
        new TwoKeyError("nope", "approver_not_codeowner"),
      );
      const { res } = await call(
        `${BASE}/general`,
        "PUT",
        { image: "golang:1.23" },
        { headers: { "x-lore-approval-pr": "#5" } },
      );

      expect(res.result).toMatchObject({
        error: "codeowners_check_failed",
        code: "approver_not_codeowner",
      });
    });

    it("rejects an invalid update body with 400", async () => {
      const { res } = await call(`${BASE}/general`, "PUT", {
        model: 123,
      });

      expect(res.statusCode).toBe(400);
      expect((res.result as { error: string }).error).toBe("invalid_agent");
    });

    it("a create with pod_resources writes the block merged over the inherited config, never the block alone", async () => {
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills: ["lore-context"] },
      });
      fakeAgents.create.mockResolvedValue(def);
      const { res } = await call(BASE, "POST", {
        name: "general",
        pod_resources: { limits: { memory: "4Gi" } },
      });

      expect(res.statusCode).toBe(200);
      expect(fakeAgents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "general",
          config: {
            skills: ["lore-context"],
            pod_resources: { limits: { memory: "4Gi" } },
          },
        }),
      );
      expect(fakeAgents.create.mock.calls[0][0]).not.toHaveProperty(
        "pod_resources",
      );
    });

    it("an update with pod_resources hands the adapter the block plus the inherited config to merge inside the upsert", async () => {
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills: ["lore-context"] },
      });
      fakeAgents.update.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "PUT", {
        pod_resources: { limits: { memory: "4Gi" } },
      });

      expect(res.statusCode).toBe(200);
      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        {
          podResources: { limits: { memory: "4Gi" } },
          inheritedConfig: { skills: ["lore-context"] },
        },
      );
    });

    it("a partial PUT for pod_resources merges per sub-key, not replaces the whole block", async () => {
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: {
          pod_resources: {
            limits: { memory: "4Gi", "ephemeral-storage": "4Gi" },
            requests: { memory: "2Gi" },
          },
        },
      });
      fakeAgents.update.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "PUT", {
        pod_resources: { requests: { "ephemeral-storage": "4Gi" } },
      });

      expect(res.statusCode).toBe(200);
      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        expect.objectContaining({
          podResources: {
            limits: { memory: "4Gi", "ephemeral-storage": "4Gi" },
            requests: { memory: "2Gi", "ephemeral-storage": "4Gi" },
          },
        }),
      );
    });

    it("an update with mcp_servers hands the adapter the list whole", async () => {
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);
      const files = { name: "files", transport: "stdio", command: "npx" };
      const { res } = await call(`${BASE}/general`, "PUT", {
        mcp_servers: [files],
      });

      expect(res.statusCode).toBe(200);
      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        { mcpServers: [files], inheritedConfig: null },
      );
    });

    it("an update with an empty mcp_servers hands the adapter the empty list, so the repo runs none of the org's servers", async () => {
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);

      await call(`${BASE}/general`, "PUT", { mcp_servers: [] });

      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        { mcpServers: [], inheritedConfig: null },
      );
    });

    it("an update with skills hands the adapter the list whole", async () => {
      delete process.env.LORE_SKILLS_URL;
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "PUT", {
        skills: ["cli-design"],
      });

      expect(res.statusCode).toBe(200);
      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        { skills: ["cli-design"], inheritedConfig: null },
      );
    });

    it("an update with an empty skills hands the adapter the empty list, so the repo runs none of the org's skills", async () => {
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);

      await call(`${BASE}/general`, "PUT", { skills: [] });

      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        { skills: [], inheritedConfig: null },
      );
    });

    it("an update with skills also hands the adapter LORE_SKILLS_URL as the skills_source default", async () => {
      process.env.LORE_SKILLS_URL = "https://skills.test";
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);

      await call(`${BASE}/general`, "PUT", { skills: ["cli-design"] });

      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        {
          skills: ["cli-design"],
          skillsSource: "https://skills.test",
          inheritedConfig: null,
        },
      );
    });

    it("an update with adjust_skill_models false hands the adapter the flag and the LORE_SKILLS_URL default", async () => {
      process.env.LORE_SKILLS_URL = "https://skills.test";
      fakeAgents.resolve.mockResolvedValue({ ...def, config: null });
      fakeAgents.update.mockResolvedValue(def);

      await call(`${BASE}/general`, "PUT", { adjust_skill_models: false });

      expect(fakeAgents.update).toHaveBeenCalledWith(
        "general",
        {},
        {
          adjustSkillModels: false,
          skillsSource: "https://skills.test",
          inheritedConfig: null,
        },
      );
    });

    it("a create with adjust_skill_models false stores the inherited https://org.skills as https://org.skills/verbatim", async () => {
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills_source: "https://org.skills" },
      });
      fakeAgents.create.mockResolvedValue(def);

      await call(BASE, "POST", { name: "general", adjust_skill_models: false });

      expect(fakeAgents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { skills_source: "https://org.skills/verbatim" },
        }),
      );
    });

    it("answers 400 for the skill name Cli Design on a PUT", async () => {
      const { res } = await call(`${BASE}/general`, "PUT", {
        skills: ["Cli Design"],
      });

      expect(res.statusCode).toBe(400);
    });

    it("a create with skills writes cli-design and the skills_source default over the inherited config", async () => {
      process.env.LORE_SKILLS_URL = "https://skills.test";
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills: ["lore-context"] },
      });
      fakeAgents.create.mockResolvedValue(def);

      await call(BASE, "POST", { name: "general", skills: ["cli-design"] });

      expect(fakeAgents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            skills: ["cli-design"],
            skills_source: "https://skills.test",
          },
        }),
      );
    });

    it("a create with skills keeps the inherited skills_source https://org.skills", async () => {
      process.env.LORE_SKILLS_URL = "https://skills.test";
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills_source: "https://org.skills" },
      });
      fakeAgents.create.mockResolvedValue(def);

      await call(BASE, "POST", { name: "general", skills: ["cli-design"] });

      expect(fakeAgents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            skills: ["cli-design"],
            skills_source: "https://org.skills",
          },
        }),
      );
    });

    it("a create with mcp_servers writes the list over the inherited config", async () => {
      fakeAgents.resolve.mockResolvedValue({
        ...def,
        config: { skills: ["lore-context"] },
      });
      fakeAgents.create.mockResolvedValue(def);
      const files = { name: "files", transport: "stdio", command: "npx" };

      await call(BASE, "POST", { name: "general", mcp_servers: [files] });

      expect(fakeAgents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { skills: ["lore-context"], mcp_servers: [files] },
        }),
      );
    });

    it("deletes an agent by name", async () => {
      fakeAgents.delete.mockResolvedValue(undefined);
      const { res } = await call(`${BASE}/general`, "DELETE");

      expect(res.result).toEqual({
        ok: true,
        deleted: "general",
      });
      expect(fakeAgents.delete).toHaveBeenCalledWith("general");
    });
  });
});
