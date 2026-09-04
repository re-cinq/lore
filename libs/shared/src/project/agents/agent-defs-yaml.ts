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

// Read-only AgentDefsPort over task-types.yaml (offline/bootstrap fallback); writes throw.

const READ_ONLY = "agent definitions are read-only without a database";

/** Union of candidate task-types.yaml paths from both loaders; <cwd>/scripts is the mcp-server path. */
function candidatePaths(
  configPath: string | undefined,
  env: NodeJS.ProcessEnv,
): string[] {
  const paths: string[] = [];

  if (configPath) {
    paths.push(resolve(configPath));
  }

  if (env.TASK_TYPES_PATH) {
    paths.push(resolve(env.TASK_TYPES_PATH));
  }
  paths.push(
    resolve("scripts/task-types.yaml"),
    resolve("task-types.yaml"),
    resolve("../scripts/task-types.yaml"),
    "/config/task-types.yaml",
  );

  if (env.CONTEXT_PATH) {
    paths.push(resolve(env.CONTEXT_PATH, "scripts/task-types.yaml"));
  }

  if (env.HOME) {
    paths.push(resolve(env.HOME, ".re-cinq/lore/scripts/task-types.yaml"));
  }

  return paths;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one raw task-types.yaml entry; shape owned by task-types-config.js
type TaskTypeConfig = any;

/** Recipe extras (skills, disallowed_tools, watch, repo_workdir) ride config so CRD builder sees same shape from fallback/DB. */
function recipeExtras(cfg: TaskTypeConfig): Record<string, unknown> {
  return {
    ...(cfg.skills ? { skills: cfg.skills } : {}),
    ...(cfg.disallowed_tools ? { disallowed_tools: cfg.disallowed_tools } : {}),
    ...(cfg.watch ? { watch: cfg.watch } : {}),
    ...(cfg.repo_workdir !== undefined
      ? { repo_workdir: cfg.repo_workdir }
      : {}),
  };
}

function definitionCore(
  cfg: TaskTypeConfig,
): Pick<
  AgentDefinition,
  "model" | "timeout_minutes" | "execution_mode" | "review_required"
> {
  return {
    model: cfg.model ?? null,
    timeout_minutes: cfg.timeout_minutes ?? null,
    execution_mode: cfg.execution_mode ?? "claude-code",
    review_required: cfg.review_required ?? false,
  };
}

function promptFor(cfg: TaskTypeConfig): string | null {
  return cfg.prompt_template ? cfg.prompt_template : null;
}

function configOrNull(
  config: Record<string, unknown>,
): Record<string, unknown> | null {
  return Object.keys(config).length > 0 ? config : null;
}

function definitionFromConfig(
  name: string,
  cfg: TaskTypeConfig,
): AgentDefinition {
  return {
    name,
    ...definitionCore(cfg),
    prompt: promptFor(cfg),
    image: null,
    project_id: null,
    config: configOrNull(recipeExtras(cfg)),
  };
}

/** feature-planning uses canonical prompt_template; feature-decompose overridden to DECOMPOSITION_INSTRUCTIONS. */
function applyFeatureDecomposeOverride(
  map: Map<string, AgentDefinition>,
): void {
  const fd = map.get("feature-decompose");

  if (fd) {
    map.set("feature-decompose", {
      ...fd,
      prompt: DECOMPOSITION_INSTRUCTIONS,
    });
  }
}

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

    for (const p of candidatePaths(this.configPath, this.env)) {
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

    // Same ConfigMap risk as Floor reader (#866); fallback runs in lore-api and mcp-server.
    warnOnDrift("[agent-defs]", p, drift);
    const map = new Map<string, AgentDefinition>();

    for (const [name, cfg] of Object.entries(taskTypes)) {
      map.set(name, definitionFromConfig(name, cfg));
    }
    applyFeatureDecomposeOverride(map);

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
