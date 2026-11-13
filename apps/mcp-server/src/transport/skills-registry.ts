import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type { SkillDefinition } from "@re-cinq/lore-shared/models/skill-definition.js";
import { skillContentForModel } from "@re-cinq/lore-shared/agent-defaults/skill-for-model.js";
import { enabledSkillNamed, readCatalogue } from "./catalogue-skills.js";

/** A skill dir name: no path separators, no leading dot, no traversal. */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERBATIM_PREFIX = "verbatim/";

interface SkillsRequest {
  path: string;
  verbatim: boolean;
}

// The skills registry the ai-agent-subsystem init fetches from; unauthenticated since skills are org conventions, not secrets. Returns true when it owns a `/skills/` path, else false so the caller falls through to MCP.
export async function handleSkillsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  skillsRoot: string,
): Promise<boolean> {
  const skillsRequest = parseSkillsRequest(req);

  if (skillsRequest === null) {
    return false;
  }

  await serveSkillsPath(req, res, skillsRoot, skillsRequest);

  return true;
}

// The flat settings.json, a per-vendor hook bundle, or a skill tarball, most specific first.
async function serveSkillsPath(
  req: IncomingMessage,
  res: ServerResponse,
  skillsRoot: string,
  skillsRequest: SkillsRequest,
): Promise<void> {
  const { path } = skillsRequest;

  if (path === "settings.json") {
    await serveSettings(res, skillsRoot);

    return;
  }

  const hooks = /^hooks\/([^/]+)\.tar\.gz$/.exec(path);

  if (hooks) {
    await serveTarball(res, resolve(skillsRoot, "hooks"), hooks[1], "home");

    return;
  }

  await serveNamedTarball(req, res, skillsRoot, skillsRequest);
}

// The `/skills/<name>` suffix (a leading `verbatim/` split off) and whether it was verbatim, GET-only; null when this request doesn't own a skills path at all.
function parseSkillsRequest(req: IncomingMessage): SkillsRequest | null {
  const url = req.url ?? "";

  if (req.method !== "GET" || !url.startsWith("/skills/")) {
    return null;
  }

  const [suffix] = url.slice("/skills/".length).split("?");
  const verbatim = suffix.startsWith(VERBATIM_PREFIX);

  return {
    path: verbatim ? suffix.slice(VERBATIM_PREFIX.length) : suffix,
    verbatim,
  };
}

async function serveNamedTarball(
  req: IncomingMessage,
  res: ServerResponse,
  skillsRoot: string,
  skillsRequest: SkillsRequest,
): Promise<void> {
  const name = tarballSkillName(skillsRequest.path);

  if (!name) {
    res.writeHead(404).end();

    return;
  }
  const bakedParent = resolve(skillsRoot, "skills");

  if (await isServableDir(bakedParent, name)) {
    await serveTarball(res, bakedParent, name, "named");

    return;
  }

  await serveCatalogueToCluster(req, res, name, skillsRequest);
}

// Every ingress controller sets x-forwarded-for and a client cannot remove it; a pod's direct in-cluster request has none.
export function isForwardedByProxy(headers: IncomingHttpHeaders): boolean {
  return headers["x-forwarded-for"] !== undefined;
}

async function serveCatalogueToCluster(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  skillsRequest: SkillsRequest,
): Promise<void> {
  if (isForwardedByProxy(req.headers)) {
    res.writeHead(404).end();

    return;
  }
  await serveCatalogueSkill(
    res,
    name,
    skillsRequest.verbatim ? null : agentModelOf(req.headers),
  );
}

function agentModelOf(headers: IncomingHttpHeaders): string | null {
  const header = headers["x-agent-model"];
  const model = (Array.isArray(header) ? header[0] : header)?.trim();

  return model ? model : null;
}

// Baked skills win; any other name is looked up in the org catalogue, so a skill made on /skills reaches a pod without an image build.
async function serveCatalogueSkill(
  res: ServerResponse,
  name: string,
  agentModel: string | null,
): Promise<void> {
  const catalogue = await readCatalogue().catch(() => null);

  if (!catalogue) {
    console.error(`[lore] skills registry: catalogue unreachable for ${name}`);
    res.writeHead(502).end();

    return;
  }
  const skill = enabledSkillNamed(catalogue, name);

  if (!skill) {
    res.writeHead(404).end();

    return;
  }
  await serveSkillFromTemp(res, skill, agentModel);
}

async function serveSkillFromTemp(
  res: ServerResponse,
  skill: SkillDefinition,
  agentModel: string | null,
): Promise<void> {
  const parentDir = await mkdtemp(join(tmpdir(), "lore-skill-"));

  await mkdir(join(parentDir, skill.name));
  await writeFile(
    join(parentDir, skill.name, "SKILL.md"),
    catalogueContentFor(skill, agentModel),
  );
  await serveTarball(res, parentDir, skill.name, "named");
  await rm(parentDir, { recursive: true, force: true });
}

function catalogueContentFor(
  skill: SkillDefinition,
  agentModel: string | null,
): string {
  return agentModel === null
    ? skill.content
    : skillContentForModel(skill.content, agentModel);
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
  await pipeTar(res, spawn("tar", tarArgs(parentDir, name, layout)));
}

function pipeTar(res: ServerResponse, tar: ChildProcess): Promise<void> {
  tar.stdout?.pipe(res);

  return new Promise<void>((done) => {
    tar.on("error", () => {
      res.end();
      done();
    });
    tar.on("close", () => done());
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
