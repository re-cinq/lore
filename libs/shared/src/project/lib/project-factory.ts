import { enforceTrue } from "../../lib/enforce.js";
import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import type { ProjectProviders } from "./providers.js";
import type { LeasePool } from "../leases/lease-backends.js";
import { Project } from "./project.js";

// Agent definitions port, three-way seam by environment: DB present -> PgAgentDefs, API only -> AgentDefsHttp, neither -> AgentDefsYaml.
async function agentDefsForEnv(
  env: NodeJS.ProcessEnv,
  pgPool: PgPool,
): Promise<unknown> {
  if (env.LORE_DB_HOST) {
    const { PgAgentDefs } = await import("../agents/agent-defs-pg.js");
    const { AgentDefsYaml } = await import("../agents/agent-defs-yaml.js");

    return new PgAgentDefs(pgPool, new AgentDefsYaml(undefined, env));
  }

  if (env.LORE_API_URL) {
    const { AgentDefsHttp } = await import("../agents/agent-defs-http.js");

    return new AgentDefsHttp(env.LORE_API_URL, env.LORE_INGEST_TOKEN);
  }
  const { AgentDefsYaml } = await import("../agents/agent-defs-yaml.js");

  return new AgentDefsYaml(undefined, env);
}

// Leases: Postgres in cluster mode (LORE_DB_HOST set), file-backed under ~/.lore/leases for the local runner — mirrors the agent's leaseBackendForEnv.
async function leasesForEnv(
  env: NodeJS.ProcessEnv,
  pgPool: PgPool,
  providers: ProjectProviders,
): Promise<unknown> {
  const { DbLeaseBackend, FileLeaseBackend } =
    await import("../leases/lease-backends.js");

  if (env.LORE_DB_HOST) {
    // The real pg pool returns rowCount; PgPool's narrow type omits it.
    return (
      providers.pipeline?.leases ??
      new DbLeaseBackend(pgPool as unknown as LeasePool)
    );
  }
  const os = await import("node:os");
  const path = await import("node:path");

  return new FileLeaseBackend(path.join(os.homedir(), ".lore", "leases"));
}

/** Builds a Project from a repo fullName + two DB connections; Project owns port init (every adapter is constructed here via dynamic import so no heavy dep loads statically). Boot-time composition root, called once per repo. */
export interface ProjectOptions {
  env?: NodeJS.ProcessEnv;
  providers?: ProjectProviders;
}

export async function createProject(
  fullName: string,
  pgPool: PgPool,
  dgraphClient: DgraphClientPort,
  { env = process.env, providers = {} }: ProjectOptions = {},
): Promise<Project> {
  const ports = new Map<string, unknown>();

  const { MemoryStoreBridge } =
    await import("../memory/memory-store-bridge.js");
  const { selectMemoryStore } = await import("../../memory-store.js");

  ports.set(
    "memory",
    new MemoryStoreBridge(selectMemoryStore({ pgPool, dgraph: dgraphClient })),
  );

  const { PgTaskStore } = await import("../tasks/task-store-pg.js");

  ports.set("tasks", new PgTaskStore(pgPool));

  const { PgChunks } = await import("../chunks/chunks-pg.js");

  ports.set("chunks", new PgChunks(pgPool));

  // pipeline.* tables are org-wide — a caller that already built the bundle passes it in so every repo shares those adapters; the fallback keeps tests/bootstrap callers working as before.
  if (providers.pipeline) {
    ports.set("pipeline", providers.pipeline);
  }

  const { PgAssemblyRuns } =
    await import("../assembly-runs/assembly-runs-pg.js");

  ports.set(
    "assemblyRuns",
    providers.pipeline?.assemblyRuns ?? new PgAssemblyRuns(pgPool),
  );

  const { PlatformGitHub } = await import("./platform-github.js");
  const github = new PlatformGitHub(env);

  ports.set("github", github);
  ports.set("pulls", github);

  const { PgSettings } = await import("../settings/settings-pg.js");

  ports.set("settings", new PgSettings(pgPool, github));

  const { NotifySlack } = await import("../notify/notify-slack.js");

  ports.set("notify", new NotifySlack(pgPool, env));

  const { PgKnowledge } = await import("../knowledge/knowledge-pg.js");

  ports.set("knowledge", new PgKnowledge(pgPool));

  const { GitCli } = await import("../workspace/git-cli.js");

  ports.set("git", new GitCli(env));

  const { ExecTestRunner } = await import("../test-runner/test-runner-exec.js");

  ports.set("tests", new ExecTestRunner());

  const { DgraphTrace } = await import("../trace/trace-dgraph.js");

  ports.set("trace", new DgraphTrace(dgraphClient));

  const { AgentRunner } = await import("../agents/agent-runner.js");

  ports.set(
    "agentRunner",
    new AgentRunner(env, { station: providers.station, llm: providers.llm }),
  );

  ports.set("agentDefs", await agentDefsForEnv(env, pgPool));

  const { PgAudit } = await import("../audit/audit-pg.js");

  ports.set("audit", providers.pipeline?.audit ?? new PgAudit(pgPool));

  const { PgUsage } = await import("../usage/usage-pg.js");

  ports.set("usage", new PgUsage(pgPool));

  const { PgFeatures } = await import("../features/features-pg.js");

  ports.set("features", new PgFeatures(pgPool));

  ports.set("leases", await leasesForEnv(env, pgPool, providers));

  return new Project(fullName, ports, env);
}

let registeredProject: Project | null = null;

export function setProject(project: Project): void {
  registeredProject = project;
}

export function project(): Project {
  enforceTrue(
    registeredProject,
    Error,
    "No Project registered — call setProject() during boot",
  );

  return registeredProject;
}
