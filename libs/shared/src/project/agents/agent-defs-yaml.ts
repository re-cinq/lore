import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTaskTypesFile,
  warnOnDrift,
} from "../../task-types/task-types-config.js";
import {
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
} from "./agent-defs-port.js";
import { DECOMPOSITION_INSTRUCTIONS } from "../../feature-planning/decomposition-instructions.js";

/**
 * Read-only AgentDefsPort over task-types.yaml — the offline/bootstrap fallback
 * (no DB, no API). Maps each task type's prompt_template/model/timeout into an
 * org-level AgentDefinition. Writes throw: definitions are only mutable with a
 * database behind the port.
 */

const READ_ONLY = "agent definitions are read-only without a database";

export class AgentDefsYaml implements AgentDefsPort {
  private cache: Map<string, AgentDefinition> | null = null;

  constructor(
    private readonly configPath?: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private load(): Map<string, AgentDefinition> {
    if (this.cache) {
      return this.cache;
    }

    // Union of the candidate paths used by both existing loaders (mcp-server's
    // pipeline-config and floor's config) so the base resolves regardless of the
    // runtime cwd: <cwd>/scripts is the one the mcp-server (repo-root cwd) uses.
    const paths: string[] = [];

    if (this.configPath) {
      paths.push(resolve(this.configPath));
    }

    if (this.env.TASK_TYPES_PATH) {
      paths.push(resolve(this.env.TASK_TYPES_PATH));
    }
    paths.push(
      resolve("scripts/task-types.yaml"),
      resolve("task-types.yaml"),
      resolve("../scripts/task-types.yaml"),
      "/config/task-types.yaml",
    );

    if (this.env.CONTEXT_PATH) {
      paths.push(resolve(this.env.CONTEXT_PATH, "scripts/task-types.yaml"));
    }

    if (this.env.HOME) {
      paths.push(
        resolve(this.env.HOME, ".re-cinq/lore/scripts/task-types.yaml"),
      );
    }

    for (const p of paths) {
      try {
        const map = this.definitionsFromFile(p);

        this.cache = map;

        return map;
      } catch {
        // try next path
      }
    }
    this.cache = new Map();

    return this.cache;
  }

  private definitionsFromFile(p: string): Map<string, AgentDefinition> {
    const { taskTypes, drift } = parseTaskTypesFile(readFileSync(p, "utf-8"));

    // Same ConfigMap, same #866 risk as the Floor's reader — this fallback
    // runs inside lore-api and mcp-server, which read their own copies.
    warnOnDrift("[agent-defs]", p, drift);
    const map = new Map<string, AgentDefinition>();

    for (const [name, cfg] of Object.entries(taskTypes)) {
      // The recipe extras (skills, disallowed_tools, watch, repo_workdir)
      // ride the config object so the CRD builder sees the same shape from
      // this fallback as from a DB row. Null when the entry declares none.
      const config = {
        ...(cfg.skills ? { skills: cfg.skills } : {}),
        ...(cfg.disallowed_tools
          ? { disallowed_tools: cfg.disallowed_tools }
          : {}),
        ...(cfg.watch ? { watch: cfg.watch } : {}),
        ...(cfg.repo_workdir !== undefined
          ? { repo_workdir: cfg.repo_workdir }
          : {}),
      };

      map.set(name, {
        name,
        model: cfg.model ?? null,
        timeout_minutes: cfg.timeout_minutes ?? null,
        prompt: cfg.prompt_template ? cfg.prompt_template : null,
        image: null,
        execution_mode: cfg.execution_mode ?? "claude-code",
        review_required: cfg.review_required ?? false,
        project_id: null,
        config: Object.keys(config).length > 0 ? config : null,
      });
    }
    // feature-planning is NOT overridden: its prompt_template IS the canonical
    // prompt now, and the recipe the pod runs is generated from it.
    // feature-decompose still is: its canonical prompt is DECOMPOSITION_INSTRUCTIONS,
    // matching the DB-seeded org default (migration 0020).
    const fd = map.get("feature-decompose");

    if (fd) {
      map.set("feature-decompose", {
        ...fd,
        prompt: DECOMPOSITION_INSTRUCTIONS,
      });
    }

    return map;
  }

  async resolve(_repo: string, name: string): Promise<AgentDefinition | null> {
    return this.load().get(name) ?? null;
  }

  async list(_repo: string): Promise<AgentDefinition[]> {
    return [...this.load().values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async create(
    _repo: string,
    _def: AgentDefinitionInput,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async update(
    _repo: string,
    _name: string,
    _patch: Partial<AgentDefinitionInput>,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async delete(_repo: string, _name: string): Promise<void> {
    throw new Error(READ_ONLY);
  }
}
