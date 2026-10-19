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
  const path = skillsSubpath(req);

  if (path === null) {
    return false;
  }

  await serveSkillsPath(res, skillsRoot, path);

  return true;
}

// The flat settings.json, a per-vendor hook bundle, or a skill tarball, most specific first.
async function serveSkillsPath(
  res: ServerResponse,
  skillsRoot: string,
  path: string,
): Promise<void> {
  if (path === "settings.json") {
    await serveSettings(res, skillsRoot);

    return;
  }

  const hooks = /^hooks\/([^/]+)\.tar\.gz$/.exec(path);

  if (hooks) {
    await serveTarball(res, resolve(skillsRoot, "hooks"), hooks[1], "home");

    return;
  }

  await serveNamedTarball(res, skillsRoot, path);
}

// The `/skills/<name>` suffix, GET-only; null when this request doesn't own a skills path at all.
function skillsSubpath(req: IncomingMessage): string | null {
  const url = req.url ?? "";

  if (req.method !== "GET" || !url.startsWith("/skills/")) {
    return null;
  }

  const suffix = url.slice("/skills/".length);

  return suffix.split("?")[0];
}

async function serveNamedTarball(
  res: ServerResponse,
  skillsRoot: string,
  path: string,
): Promise<void> {
  const name = tarballSkillName(path);

  if (!name) {
    res.writeHead(404).end();

    return;
  }
  await serveTarball(res, resolve(skillsRoot, "skills"), name, "named");
}

// A safe skill dir name out of `<name>.tar.gz`; null on anything else (no suffix, or an unsafe/traversing name).
function tarballSkillName(path: string): string | null {
  const tarball = /^([^/]+)\.tar\.gz$/.exec(path);

  if (!tarball || !SKILL_NAME.test(tarball[1])) {
    return null;
  }

  return tarball[1];
}

async function serveSettings(
  res: ServerResponse,
  skillsRoot: string,
): Promise<void> {
  // The flat settings.json an init that predates hook bundles fetches: the Claude bundle's own file, so both generations read the same hooks.
  try {
    const body = await readFile(
      join(skillsRoot, "hooks", "claude", ".claude", "settings.json"),
    );

    res.writeHead(200, { "Content-Type": "application/json" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}

// A skill tarball keeps its dir as the top-level member (`<name>/SKILL.md`, extracted into the skills dir); a hook bundle is laid out relative to $HOME (`./.claude/settings.json`), so it tars the dir's contents.
async function serveTarball(
  res: ServerResponse,
  parentDir: string,
  name: string,
  layout: "named" | "home",
): Promise<void> {
  if (!SKILL_NAME.test(name) || !(await isServableDir(parentDir, name))) {
    res.writeHead(404).end();

    return;
  }
  res.writeHead(200, { "Content-Type": "application/gzip" });
  const tar = spawn("tar", tarArgs(parentDir, name, layout));

  tar.stdout.pipe(res);
  tar.on("error", () => {
    res.end();
  });
}

function tarArgs(
  parentDir: string,
  name: string,
  layout: "named" | "home",
): string[] {
  return layout === "named"
    ? ["-czf", "-", "-C", parentDir, name]
    : ["-czf", "-", "-C", resolve(parentDir, name), "."];
}

// Belt-and-suspenders against traversal: the resolved dir must stay under its parent, whatever the name matched upstream.
async function isServableDir(
  parentDir: string,
  name: string,
): Promise<boolean> {
  const dir = resolve(parentDir, name);

  if (dir !== parentDir && !dir.startsWith(parentDir + sep)) {
    return false;
  }

  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
