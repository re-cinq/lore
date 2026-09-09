import { enforceTrue } from "../../../lib/enforce.js";
import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import type { ProjectProviders } from "./providers.js";
import type { PipelineRepositories } from "../pipeline/pipeline-repositories.js";
import type { LeasePool } from "../leases/lease-backends.js";
import type { AssemblyRunsPort } from "../assembly-runs/assembly-runs-port.js";
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

/** The org-wide pipeline bundle's adapter, when the caller already built one — else a fresh per-repo instance. */
function fromPipelineOrDefault<K extends keyof PipelineRepositories>(
  pipeline: ProjectProviders["pipeline"],
  key: K,
  fallback: PipelineRepositories[K],
): PipelineRepositories[K] {
  return pipeline?.[key] ?? fallback;
}

/** Normalizes the optional `{ env, providers }` bag callers pass, each field defaulted independently. */
function resolveProjectOptions(options: ProjectOptions): {
  env: NodeJS.ProcessEnv;
  providers: ProjectProviders;
} {
  return {
    env: options.env ?? process.env,
    providers: options.providers ?? {},
  };
}

interface StoredPortDeps {
  pgPool: PgPool;
  dgraphClient: DgraphClientPort;
  providers: ReturnType<typeof resolveProjectOptions>["providers"];
}

/** The ports this deployment's own stores answer: memory, tasks, chunks, runs, knowledge. `pipeline.*` tables are org-wide, so a caller that already built that bundle passes it in and every repo shares those adapters; the fallback keeps tests and bootstrap callers working as before. */
async function registerStoredPorts(
  ports: Map<string, unknown>,
  { pgPool, dgraphClient, providers }: StoredPortDeps,
): Promise<void> {
  const [bridge, store, tasks, chunks, runs, trace] = await storedModules();
  const memory = store.selectMemoryStore({ pgPool, dgraph: dgraphClient });

  ports.set("memory", new bridge.MemoryStoreBridge(memory));
  ports.set("tasks", new tasks.PgTaskStore(pgPool));
  ports.set("chunks", new chunks.PgChunks(pgPool));
  ports.set("trace", new trace.DgraphTrace(dgraphClient));
  registerPipelinePorts(ports, providers.pipeline, {
    assemblyRuns: new runs.PgAssemblyRuns(pgPool),
  });
}

/** Imported together rather than one before each `set`: they are loaded lazily to keep the lean MCP install free of pg/dgraph, and that laziness is about the MODULE graph, not the order the ports go into the map. */
function storedModules() {
  return Promise.all([
    import("../memory/memory-store-bridge.js"),
    import("../../memory-store.js"),
    import("../tasks/task-store-pg.js"),
    import("../chunks/chunks-pg.js"),
    import("../assembly-runs/assembly-runs-pg.js"),
    import("../trace/trace-dgraph.js"),
  ]);
}

/** The org-wide `pipeline.*` adapters. A caller that already built the bundle passes it in so every repo shares those adapters; the per-repo defaults keep tests and bootstrap callers working as before. */
function registerPipelinePorts(
  ports: Map<string, unknown>,
  pipeline: StoredPortDeps["providers"]["pipeline"],
  defaults: { assemblyRuns: AssemblyRunsPort },
): void {
  if (pipeline) {
    ports.set("pipeline", pipeline);
  }

  ports.set(
    "assemblyRuns",
    fromPipelineOrDefault(pipeline, "assemblyRuns", defaults.assemblyRuns),
  );
}

interface OutsidePortDeps {
  pgPool: PgPool;
  env: NodeJS.ProcessEnv;
  providers: ReturnType<typeof resolveProjectOptions>["providers"];
}

/** One adapter answers both the read and the write side: fetching a PR and commenting on it go through the same installation token. */
async function gitHubPort(env: NodeJS.ProcessEnv) {
  const { PlatformGitHub } = await import("./platform-github.js");

  return new PlatformGitHub(env);
}

/** The ports that reach OUTSIDE this process: GitHub, Slack, git, the test runner, the agent runner. Settings sits here rather than with the stores because it reads the repo through GitHub as well as the database. */
async function registerOutsidePorts(
  ports: Map<string, unknown>,
  { pgPool, env, providers }: OutsidePortDeps,
): Promise<void> {
  const github = await gitHubPort(env);
  const [settings, notify, knowledge, git, tests, agents] =
    await outsideModules();

  ports.set("github", github);
  ports.set("pulls", github);
  ports.set("settings", new settings.PgSettings(pgPool, github));
  ports.set("notify", new notify.NotifySlack(pgPool, env));
  ports.set("knowledge", new knowledge.PgKnowledge(pgPool));
  ports.set("git", new git.GitCli(env));
  ports.set("tests", new tests.ExecTestRunner());
  const runnerDeps = { station: providers.station, llm: providers.llm };

  ports.set("agentRunner", new agents.AgentRunner(env, runnerDeps));

  await registerLedgerPorts(ports, { pgPool, env, providers });
}

/** The adapters that reach outside the process, imported lazily for the same reason the stored ones are. */
function outsideModules() {
  return Promise.all([
    import("../settings/settings-pg.js"),
    import("../notify/notify-slack.js"),
    import("../knowledge/knowledge-pg.js"),
    import("../workspace/git-cli.js"),
    import("../test-runner/test-runner-exec.js"),
    import("../agents/agent-runner.js"),
  ]);
}

/** What the platform records about itself: who ran, what it cost, what it audited, which features it is tracking. */
async function registerLedgerPorts(
  ports: Map<string, unknown>,
  { pgPool, env, providers }: OutsidePortDeps,
): Promise<void> {
  const [audit, usage, features] = await ledgerModules();

  ports.set("agentDefs", await agentDefsForEnv(env, pgPool));
  ports.set(
    "audit",
    fromPipelineOrDefault(
      providers.pipeline,
      "audit",
      new audit.PgAudit(pgPool),
    ),
  );
  ports.set("usage", new usage.PgUsage(pgPool));
  ports.set("features", new features.PgFeatures(pgPool));
}

/** The self-record adapters, imported lazily for the same reason the stored ones are. */
function ledgerModules() {
  return Promise.all([
    import("../audit/audit-pg.js"),
    import("../usage/usage-pg.js"),
    import("../features/features-pg.js"),
  ]);
}

export async function createProject(
  fullName: string,
  pgPool: PgPool,
  dgraphClient: DgraphClientPort,
  options: ProjectOptions = {},
): Promise<Project> {
  const { env, providers } = resolveProjectOptions(options);
  const ports = new Map<string, unknown>();

  await registerStoredPorts(ports, { pgPool, dgraphClient, providers });
  await registerOutsidePorts(ports, { pgPool, env, providers });
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
