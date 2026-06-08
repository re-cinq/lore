import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import { Project } from "./project.js";

/**
 * Build a Project from a repo fullName and the two database connections. The
 * Project OWNS port initialization: every adapter is constructed here via
 * DYNAMIC import, so neither this module nor the package barrel statically pulls
 * a heavy dependency (octokit/pg/dgraph/child_process) — keeping the core
 * importable from light runtimes (web-ui). Callers never instantiate an adapter.
 *
 * Async because adapter modules are imported on demand; it is a boot-time
 * composition root, called once per repo. env defaults to process.env for the
 * trust gates and ambient GitHub/git auth.
 */
export async function createProject(
  fullName: string,
  pgPool: PgPool,
  dgraphClient: DgraphClientPort,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Project> {
  const ports = new Map<string, unknown>();

  const { MemoryStoreBridge } = await import("../memory/memory-store-bridge.js");
  const { selectMemoryStore } = await import("../../memory-store.js");
  ports.set("memory", new MemoryStoreBridge(selectMemoryStore({ pgPool, dgraph: dgraphClient })));

  const { PgTaskStore } = await import("../tasks/task-store-pg.js");
  ports.set("tasks", new PgTaskStore(pgPool));

  const { PgSettings } = await import("../settings/settings-pg.js");
  ports.set("settings", new PgSettings(pgPool));

  const { NotifySlack } = await import("../notify/notify-slack.js");
  ports.set("notify", new NotifySlack(pgPool, env));

  const { PgKnowledge } = await import("../knowledge/knowledge-pg.js");
  ports.set("knowledge", new PgKnowledge(pgPool));

  const { GitCli } = await import("../workspace/git-cli.js");
  ports.set("git", new GitCli(env));

  const { ExecTestRunner } = await import("../test-runner/test-runner-exec.js");
  ports.set("tests", new ExecTestRunner());

  const { PlatformGitHub } = await import("./platform-github.js");
  const github = new PlatformGitHub(env);
  ports.set("github", github);
  ports.set("pulls", github);

  return new Project(fullName, ports, env);
}

let registeredProject: Project | null = null;

export function setProject(project: Project): void {
  registeredProject = project;
}

export function project(): Project {
  if (!registeredProject) {
    throw new Error("No Project registered — call setProject() during boot");
  }
  return registeredProject;
}
