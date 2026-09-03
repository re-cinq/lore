import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** A skill dir name: no path separators, no leading dot, no traversal. */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The skills registry the ai-agent-subsystem init fetches from; unauthenticated since skills are org conventions, not secrets. Returns true when it owns a `/skills/` path, else false so the caller falls through to MCP.
export async function handleSkillsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  skillsRoot: string,
): Promise<boolean> {
  const url = req.url ?? "";

  if (req.method !== "GET" || !url.startsWith("/skills/")) {
    return false;
  }
  const path = url.slice("/skills/".length).split("?")[0];

  if (path === "settings.json") {
    await serveSettings(res, skillsRoot);

    return true;
  }

  const tarball = /^([^/]+)\.tar\.gz$/.exec(path);

  if (!tarball || !SKILL_NAME.test(tarball[1])) {
    res.writeHead(404).end();

    return true;
  }
  await serveSkillTarball(res, skillsRoot, tarball[1]);

  return true;
}

async function serveSettings(
  res: ServerResponse,
  skillsRoot: string,
): Promise<void> {
  try {
    const body = await readFile(join(skillsRoot, "settings.json"));

    res.writeHead(200, { "Content-Type": "application/json" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}

async function serveSkillTarball(
  res: ServerResponse,
  skillsRoot: string,
  name: string,
): Promise<void> {
  const skillsDir = resolve(skillsRoot, "skills");
  const dir = resolve(skillsDir, name);

  // Belt-and-suspenders against traversal: the resolved dir must stay under skills/.
  if (dir !== skillsDir && !dir.startsWith(skillsDir + sep)) {
    res.writeHead(404).end();

    return;
  }

  try {
    if (!(await stat(dir)).isDirectory()) {
      res.writeHead(404).end();

      return;
    }
  } catch {
    res.writeHead(404).end();

    return;
  }
  res.writeHead(200, { "Content-Type": "application/gzip" });
  const tar = spawn("tar", ["-czf", "-", "-C", skillsDir, name]);

  tar.stdout.pipe(res);
  tar.on("error", () => {
    res.end();
  });
}
