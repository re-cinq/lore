import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
} from "./agent-defs-port.js";

/**
 * Read-only AgentDefsPort over task-types.yaml — the offline/bootstrap fallback
 * (no DB, no API). Maps each task type's prompt_template/model/timeout into an
 * org-level AgentDefinition. Writes throw: definitions are only mutable with a
 * database behind the port.
 */

interface YamlTaskType {
  prompt_template?: string;
  timeout_minutes?: number;
  review_required?: boolean;
  model?: string;
  execution_mode?: string;
}

const READ_ONLY = "agent definitions are read-only without a database";

export class AgentDefsYaml implements AgentDefsPort {
  private cache: Map<string, AgentDefinition> | null = null;

  constructor(
    private readonly configPath?: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private load(): Map<string, AgentDefinition> {
    if (this.cache) return this.cache;

    // Union of the candidate paths used by both existing loaders (mcp-server's
    // pipeline-config and floor's config) so the base resolves regardless of the
    // runtime cwd: <cwd>/scripts is the one the mcp-server (repo-root cwd) uses.
    const paths: string[] = [];
    if (this.configPath) paths.push(resolve(this.configPath));
    if (this.env.TASK_TYPES_PATH) paths.push(resolve(this.env.TASK_TYPES_PATH));
    paths.push(
      resolve("scripts/task-types.yaml"),
      resolve("task-types.yaml"),
      resolve("../scripts/task-types.yaml"),
      "/config/task-types.yaml",
    );
    if (this.env.CONTEXT_PATH) paths.push(resolve(this.env.CONTEXT_PATH, "scripts/task-types.yaml"));
    if (this.env.HOME) paths.push(resolve(this.env.HOME, ".re-cinq/lore/scripts/task-types.yaml"));

    for (const p of paths) {
      try {
        const parsed = parse(readFileSync(p, "utf-8")) as {
          task_types?: Record<string, YamlTaskType>;
        };
        const map = new Map<string, AgentDefinition>();
        for (const [name, cfg] of Object.entries(parsed.task_types ?? {})) {
          map.set(name, {
            name,
            model: cfg.model ?? null,
            timeout_minutes: cfg.timeout_minutes ?? null,
            prompt: cfg.prompt_template ? cfg.prompt_template : null,
            image: null,
            execution_mode: cfg.execution_mode ?? "claude-code",
            review_required: cfg.review_required ?? false,
            project_id: null,
          });
        }
        this.cache = map;
        return map;
      } catch {
        // try next path
      }
    }
    this.cache = new Map();
    return this.cache;
  }

  async resolve(_repo: string, name: string): Promise<AgentDefinition | null> {
    return this.load().get(name) ?? null;
  }

  async list(_repo: string): Promise<AgentDefinition[]> {
    return [...this.load().values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(_repo: string, _def: AgentDefinitionInput): Promise<AgentDefinition> {
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
