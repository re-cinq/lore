import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-files.js";
import { loadSkillDefaults } from "@re-cinq/lore-shared/agent-defaults/skill-defaults-files.js";
import type { SkillDefinition } from "@re-cinq/lore-shared/models/skill-definition.js";
import { handleSkillsRequest, isForwardedByProxy } from "./skills-registry.js";

const skillsRoot = resolve(import.meta.dirname, "../../agent-skills");

function mockRes() {
  const res = new PassThrough();
  const captured = { status: 0, headers: {} as Record<string, string> };

  (res as unknown as ServerResponse).writeHead = ((
    status: number,
    headers?: Record<string, string>,
  ) => {
    captured.status = status;
    captured.headers = headers ?? {};

    return res as unknown as ServerResponse;
  }) as ServerResponse["writeHead"];

  const body = () =>
    new Promise<Buffer>((res_) => {
      const chunks: Buffer[] = [];

      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => res_(Buffer.concat(chunks)));
    });

  return { res: res as unknown as ServerResponse, captured, body };
}

const req = (method: string, url: string, headers = {}) =>
  ({ method, url, headers }) as IncomingMessage;

describe("handleSkillsRequest", () => {
  it("returns false for a non-skills path so the caller falls through to MCP", async () => {
    const { res } = mockRes();

    expect(
      await handleSkillsRequest(req("POST", "/mcp"), res, skillsRoot),
    ).toBe(false);
  });

  it("serves settings.json with the org hooks", async () => {
    const { res, captured, body } = mockRes();
    const done = body();

    await handleSkillsRequest(
      req("GET", "/skills/settings.json"),
      res,
      skillsRoot,
    );
    expect(captured.status).toBe(200);
    expect(JSON.parse((await done).toString())).toHaveProperty("hooks");
  });

  it("404s a traversal / unsafe skill name", async () => {
    const { res, captured } = mockRes();

    await handleSkillsRequest(
      req("GET", "/skills/..%2fevil.tar.gz"),
      res,
      skillsRoot,
    );
    expect(captured.status).toBe(404);
  });

  it("404s a /skills/ path with no recognized suffix", async () => {
    const { res, captured } = mockRes();

    await handleSkillsRequest(
      req("GET", "/skills/not-a-tarball"),
      res,
      skillsRoot,
    );
    expect(captured.status).toBe(404);
  });

  it("returns false for a non-GET method even on a /skills/ path", async () => {
    const { res } = mockRes();

    expect(
      await handleSkillsRequest(
        req("POST", "/skills/lore-context.tar.gz"),
        res,
        skillsRoot,
      ),
    ).toBe(false);
  });

  it("serves a baked skill as a gzip tarball", async () => {
    const { res, captured, body } = mockRes();
    const done = body();

    await handleSkillsRequest(
      req("GET", "/skills/lore-context.tar.gz"),
      res,
      skillsRoot,
    );
    expect(captured.status).toBe(200);
    expect(captured.headers["Content-Type"]).toBe("application/gzip");

    const buf = await done;

    expect([buf[0], buf[1]]).toEqual([0x1f, 0x8b]);
  });
});

function catalogueSkill(
  name: string,
  overrides: Partial<SkillDefinition> = {},
): SkillDefinition {
  return {
    name,
    title: name,
    description: "",
    model: null,
    content: `# ${name}\n\nbody`,
    enabled: true,
    projectId: null,
    ...overrides,
  };
}

async function skillsGet(url: string, headers = {}) {
  const { res, captured, body } = mockRes();
  const done = body();

  await handleSkillsRequest(req("GET", url, headers), res, skillsRoot);

  return {
    status: captured.status,
    body: await done.catch(() => Buffer.alloc(0)),
  };
}

describe("handleSkillsRequest catalogue fallback", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serves the catalogue skill cli-design as a tarball whose cli-design/SKILL.md is the row's content", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [catalogueSkill("cli-design")] }),
    });

    const { status, body } = await skillsGet("/skills/cli-design.tar.gz");

    expect({
      status,
      skillMd: execFileSync("tar", ["-xzOf", "-", "cli-design/SKILL.md"], {
        input: body,
      }).toString(),
    }).toEqual({ status: 200, skillMd: "# cli-design\n\nbody" });
  });

  it("serves every skill the task-type recipes declare, guarding against per-recipe skill drift (specs/floor-on-ai-subsystem FR34)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: loadSkillDefaults().map((skill) => catalogueSkill(skill.name)),
      }),
    });
    const declared = [
      ...new Set(loadAgentDefaults().flatMap((r) => r.config?.skills ?? [])),
    ].sort();

    const served = await Promise.all(
      declared.map(async (name) => ({
        name,
        status: (await skillsGet(`/skills/${name}.tar.gz`)).status,
      })),
    );

    expect(served).toEqual(declared.map((name) => ({ name, status: 200 })));
  });

  it("serves the baked lore-context without asking the catalogue, whatever the catalogue holds under that name", async () => {
    const { status, body } = await skillsGet("/skills/lore-context.tar.gz");

    expect({
      status,
      gzip: [body[0], body[1]],
      catalogueCalls: fetchMock.mock.calls.length,
    }).toEqual({ status: 200, gzip: [0x1f, 0x8b], catalogueCalls: 0 });
  });

  it("answers 404 for the disabled catalogue skill cli-design", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [catalogueSkill("cli-design", { enabled: false })],
      }),
    });

    expect((await skillsGet("/skills/cli-design.tar.gz")).status).toBe(404);
  });

  it("answers 404 for the name no-such-skill that the catalogue lacks", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [catalogueSkill("cli-design")] }),
    });

    expect((await skillsGet("/skills/no-such-skill.tar.gz")).status).toBe(404);
  });

  it("answers 502 when lore-api refuses the catalogue read with 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    expect((await skillsGet("/skills/cli-design.tar.gz")).status).toBe(502);
  });

  it("answers 404 for cli-design to a request forwarded from 203.0.113.7 and never fetches the catalogue", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [catalogueSkill("cli-design")] }),
    });

    const { status } = await skillsGet("/skills/cli-design.tar.gz", {
      "x-forwarded-for": "203.0.113.7",
    });

    expect({ status, catalogueCalls: fetchMock.mock.calls.length }).toEqual({
      status: 404,
      catalogueCalls: 0,
    });
  });

  it("still serves the baked lore-context to a request forwarded from 203.0.113.7", async () => {
    const { status, body } = await skillsGet("/skills/lore-context.tar.gz", {
      "x-forwarded-for": "203.0.113.7",
    });

    expect({ status, gzip: [body[0], body[1]] }).toEqual({
      status: 200,
      gzip: [0x1f, 0x8b],
    });
  });
});

describe("handleSkillsRequest model adjustment", () => {
  const fetchMock = vi.fn();
  const sonnetSkill = catalogueSkill("cli-design", {
    content:
      "---\nname: cli-design\nmodel: claude-sonnet-4-6\n---\n\n# cli-design\n",
  });
  const skillMdOf = (body: Buffer) =>
    execFileSync("tar", ["-xzOf", "-", "cli-design/SKILL.md"], {
      input: body,
    }).toString();

  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [sonnetSkill] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serves cli-design without its model line when x-agent-model is gemini-4-argon", async () => {
    const { body } = await skillsGet("/skills/cli-design.tar.gz", {
      "x-agent-model": "gemini-4-argon",
    });

    expect(skillMdOf(body)).toEqual(
      "---\nname: cli-design\n---\n\n# cli-design\n",
    );
  });

  it("serves cli-design with its model line when x-agent-model is claude-sonnet-4-6", async () => {
    const { body } = await skillsGet("/skills/cli-design.tar.gz", {
      "x-agent-model": "claude-sonnet-4-6",
    });

    expect(skillMdOf(body)).toEqual(sonnetSkill.content);
  });

  it("serves cli-design with its model line when no x-agent-model is sent", async () => {
    const { body } = await skillsGet("/skills/cli-design.tar.gz");

    expect(skillMdOf(body)).toEqual(sonnetSkill.content);
  });

  it("serves cli-design with its model line from /skills/verbatim/ when x-agent-model is gemini-4-argon", async () => {
    const { body } = await skillsGet("/skills/verbatim/cli-design.tar.gz", {
      "x-agent-model": "gemini-4-argon",
    });

    expect(skillMdOf(body)).toEqual(sonnetSkill.content);
  });

  it("serves /skills/verbatim/settings.json equal to /skills/settings.json", async () => {
    const plain = await skillsGet("/skills/settings.json");
    const verbatim = await skillsGet("/skills/verbatim/settings.json");

    expect(verbatim).toEqual(plain);
    expect(verbatim.status).toBe(200);
  });

  it("serves a hook bundle from /skills/verbatim/hooks/claude.tar.gz as a gzip tarball", async () => {
    const { status, body } = await skillsGet(
      "/skills/verbatim/hooks/claude.tar.gz",
    );

    expect({ status, magic: [body[0], body[1]] }).toEqual({
      status: 200,
      magic: [0x1f, 0x8b],
    });
  });
});

describe("isForwardedByProxy", () => {
  it("is true with x-forwarded-for 203.0.113.7 and false without it", () => {
    expect([
      isForwardedByProxy({ "x-forwarded-for": "203.0.113.7" }),
      isForwardedByProxy({ host: "lore-mcp" }),
    ]).toEqual([true, false]);
  });
});
