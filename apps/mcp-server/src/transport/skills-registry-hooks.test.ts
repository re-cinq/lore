import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleSkillsRequest } from "./skills-registry.js";

const skillsRoot = resolve(import.meta.dirname, "../../agent-skills");

async function get(path: string) {
  const res = new PassThrough();
  const captured = { status: 0 };

  (res as unknown as ServerResponse).writeHead = ((status: number) => {
    captured.status = status;

    return res as unknown as ServerResponse;
  }) as ServerResponse["writeHead"];
  const body = new Promise<Buffer>((done) => {
    const chunks: Buffer[] = [];

    res.on("data", (c) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(Buffer.concat(chunks)));
  });

  await handleSkillsRequest(
    { method: "GET", url: path } as IncomingMessage,
    res as unknown as ServerResponse,
    skillsRoot,
  );

  return { status: captured.status, body: await body };
}

describe("per-vendor hook bundles", () => {
  it("serves hooks/claude.tar.gz laid out relative to HOME, carrying the settings the Bash guard is wired in", async () => {
    const { status, body } = await get("/skills/hooks/claude.tar.gz");
    const listing = spawnSync("tar", ["-tzf", "-"], { input: body })
      .stdout.toString()
      .split("\n");

    expect({
      status,
      hasSettings: listing.includes("./.claude/settings.json"),
    }).toEqual({ status: 200, hasSettings: true });
  });

  it("serves the flat settings.json from the Claude bundle, so an init that predates bundles reads the same hooks", async () => {
    const flat = await get("/skills/settings.json");
    const bundled = await get("/skills/hooks/claude.tar.gz");
    const fromBundle = spawnSync(
      "tar",
      ["-xzOf", "-", "./.claude/settings.json"],
      { input: bundled.body },
    ).stdout;

    expect(flat.body.toString()).toEqual(fromBundle.toString());
  });

  it("404s a vendor with no bundle and a traversing vendor name alike", async () => {
    const statuses = await Promise.all(
      ["/skills/hooks/cursor.tar.gz", "/skills/hooks/..%2fclaude.tar.gz"].map(
        async (path) => (await get(path)).status,
      ),
    );

    expect(statuses).toEqual([404, 404]);
  });
});
