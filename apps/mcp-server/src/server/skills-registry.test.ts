import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { handleSkillsRequest } from "./skills-registry.js";

const skillsRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../agent-skills",
);

const TASK_TYPES_PATH = "../../../../scripts/task-types.yaml";

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

const req = (method: string, url: string) =>
  ({ method, url }) as IncomingMessage;

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

  it("serves every skill the task-type recipes declare, guarding against per-recipe skill drift (specs/floor-on-ai-subsystem FR34)", async () => {
    const recipes = parse(
      await readFile(
        resolve(dirname(fileURLToPath(import.meta.url)), TASK_TYPES_PATH),
        "utf8",
      ),
    ) as { task_types?: Record<string, { skills?: string[] }> };

    const declared = [
      ...new Set(
        Object.values(recipes.task_types ?? {}).flatMap((r) => r?.skills ?? []),
      ),
    ].sort();

    const served = await Promise.all(
      declared.map(async (name) => {
        const { res, captured, body } = mockRes();
        const done = body();

        await handleSkillsRequest(
          req("GET", `/skills/${name}.tar.gz`),
          res,
          skillsRoot,
        );
        await done;

        return { name, status: captured.status };
      }),
    );

    expect(served).toEqual(declared.map((name) => ({ name, status: 200 })));
  });
});
