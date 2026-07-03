import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import type { ProjectProviders } from "./providers.js";
import type { LeasePool } from "../leases/lease-backends.js";
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
 * trust gates and ambient GitHub/git auth. `providers` optionally injects
 * clients for capabilities beyond pg+dgraph (LLM/k8s/embeddings) — methods that
 * need an absent provider throw a clear error.
 */
export async function createProject(
  fullName: string,
  pgPool: PgPool,
  dgraphClient: DgraphClientPort,
  env: NodeJS.ProcessEnv = process.env,
  providers: ProjectProviders = {},
): Promise<Project> {
  const ports = new Map<string, unknown>();

  const { MemoryStoreBridge } = await import("../memory/memory-store-bridge.js");
  const { selectMemoryStore } = await import("../../memory-store.js");
  ports.set("memory", new MemoryStoreBridge(selectMemoryStore({ pgPool, dgraph: dgraphClient })));

  const { PgTaskStore } = await import("../tasks/task-store-pg.js");
  ports.set("tasks", new PgTaskStore(pgPool));

  const { PgAssemblyLines } = await import("../assembly-lines/assembly-lines-pg.js");
  ports.set("assemblyLines", new PgAssemblyLines(pgPool));

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
  ports.set("agentRunner", new AgentRunner(env, { station: providers.station, llm: providers.llm }));

  // Agent DEFINITIONS port — three-way optional-port seam by environment:
  //   DB present   → PgAgentDefs (floor, mcp-server on GKE)
  //   API only     → AgentDefsHttp (Station pod / local stdio: fetch over egress)
  //   neither      → AgentDefsYaml (offline/bootstrap from task-types.yaml)
  if (env.LORE_DB_HOST) {
    const { PgAgentDefs } = await import("../agents/agent-defs-pg.js");
    const { AgentDefsYaml } = await import("../agents/agent-defs-yaml.js");
    ports.set("agentDefs", new PgAgentDefs(pgPool, new AgentDefsYaml(undefined, env)));
  } else if (env.LORE_API_URL) {
    const { AgentDefsHttp } = await import("../agents/agent-defs-http.js");
    ports.set("agentDefs", new AgentDefsHttp(env.LORE_API_URL, env.LORE_INGEST_TOKEN));
  } else {
    const { AgentDefsYaml } = await import("../agents/agent-defs-yaml.js");
    ports.set("agentDefs", new AgentDefsYaml(undefined, env));
  }

  const { PgAudit } = await import("../audit/audit-pg.js");
  ports.set("audit", new PgAudit(pgPool));

  const { PgUsage } = await import("../usage/usage-pg.js");
  ports.set("usage", new PgUsage(pgPool));

  const { PgFeatures } = await import("../features/features-pg.js");
  ports.set("features", new PgFeatures(pgPool));

  // Leases: Postgres in cluster mode (LORE_DB_HOST set), file-backed under
  // ~/.lore/leases for the local runner. Mirrors the agent's leaseBackendForEnv.
  const { DbLeaseBackend, FileLeaseBackend } = await import(
    "../leases/lease-backends.js"
  );
  if (env.LORE_DB_HOST) {
    // The real pg pool returns rowCount; PgPool's narrow type omits it.
    ports.set("leases", new DbLeaseBackend(pgPool as unknown as LeasePool));
  } else {
    const os = await import("node:os");
    const path = await import("node:path");
    ports.set(
      "leases",
      new FileLeaseBackend(path.join(os.homedir(), ".lore", "leases")),
    );
  }

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
