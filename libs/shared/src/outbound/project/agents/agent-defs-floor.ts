// AgentDefsWritePort over the floor's agent definitions (#3995): the org default is a definition's `settings`, a repo's override is its entry in `variants`, merged per field and per `config` key as the floor itself merges them.
import { isDeepStrictEqual } from "node:util";
import type {
  AgentDefinitionBody,
  AgentSettings,
  DefinitionApi,
} from "@re-cinq/floor-client";
import { enforceTrue } from "../../../lib/enforce.js";
import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsWritePort,
  PodResourcesWrite,
} from "./agent-defs-port.js";

type Variant = Partial<AgentSettings>;
type Patch = Partial<AgentDefinitionInput>;

/** Lore's field → the floor's settings key. execution_mode and review_required have none: nothing at run time reads them, so a floor-backed definition answers their defaults. */
const FLOOR_FIELDS = {
  model: "model",
  prompt: "prompt",
  image: "image",
  timeout_minutes: "timeoutMinutes",
  config: "config",
} as const satisfies Partial<Record<keyof Patch, keyof AgentSettings>>;

/** The settings a floor definition cannot run without, so an org write may change them but never clear them. */
const REQUIRED_FIELDS = ["prompt", "image", "timeout_minutes"] as const;

const GITHUB_HOST = "github.com";

const HOST_PREFIX = /^[^/]+\/(?=[^/]+\/[^/]+$)/;

interface VariantEntry {
  key: string;
  variant: Variant;
}

export class FloorAgentDefs implements AgentDefsWritePort {
  constructor(
    private readonly definitions: DefinitionApi<AgentDefinitionBody>,
  ) {}

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const row = await this.definitions.get(name);

    return row ? resolvedFor(name, row.body, repo) : null;
  }

  async list(repo: string): Promise<AgentDefinition[]> {
    const rows = await this.definitions.list();

    return rows
      .map((row) => resolvedFor(row.id, row.body, repo))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  create(repo: string, def: AgentDefinitionInput): Promise<AgentDefinition> {
    const { name, ...fields } = def;

    return this.update(repo, name, fields);
  }

  async update(
    repo: string,
    name: string,
    patch: Patch,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    const body = await this.bodyOf(name);
    const variant = variantEntry(body, repo)?.variant ?? {};
    const next = withVariant(body, repo, patched(variant, patch, podResources));

    await this.putChecked(name, next);

    return resolvedFor(name, next, repo);
  }

  async delete(repo: string, name: string): Promise<void> {
    const body = await this.bodyOf(name);

    await this.putChecked(name, withVariant(body, repo, {}));
  }

  /** The org default: a new version with the patched settings, every repo's variant kept. */
  async updateOrg(
    name: string,
    patch: Patch,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    enforceKeepsRequired(name, patch);
    const body = await this.bodyOf(name);
    const settings = patched(body.settings, patch, podResources);
    const next = { ...body, settings: settings as AgentSettings };

    await this.putChecked(name, next);

    return resolvedFor(name, next, null);
  }

  private async bodyOf(name: string): Promise<AgentDefinitionBody> {
    const row = await this.definitions.get(name);

    enforceTrue(row, Error, `the floor holds no agent definition ${name}`);

    return row.body;
  }

  /** The floor should store a body exactly as given; anything else would silently change what an agent runs with. */
  private async putChecked(
    name: string,
    body: AgentDefinitionBody,
  ): Promise<void> {
    await this.definitions.put(name, body);
    const stored = await this.definitions.get(name);

    enforceTrue(
      isDeepStrictEqual(stored?.body, body),
      Error,
      `the floor read agent definition ${name} back as something other than what was put`,
    );
  }
}

function enforceKeepsRequired(name: string, patch: Patch): void {
  for (const field of REQUIRED_FIELDS) {
    enforceTrue(
      patch[field] !== null,
      Error,
      `agent definition ${name} cannot clear ${field} on the floor`,
    );
  }
}

function resolvedFor(
  name: string,
  body: AgentDefinitionBody,
  repo: string | null,
): AgentDefinition {
  const entry = repo === null ? undefined : variantEntry(body, repo);
  const merged = mergedSettings(body.settings, entry?.variant);

  return {
    name,
    model: orNull(merged.model),
    timeout_minutes: orNull(merged.timeoutMinutes),
    prompt: orNull(merged.prompt),
    image: orNull(merged.image),
    execution_mode: "claude-code",
    review_required: false,
    project_id: orNull(entry?.key),
    config: orNull(merged.config) as AgentDefinition["config"],
  };
}

function orNull<Value>(value: Value | undefined): Value | null {
  return value ?? null;
}

/** The floor's own merge (re-cinq/floor mergeAgentSettings): the variant wins per field, and per key inside config. */
function mergedSettings(settings: Variant, variant: Variant | undefined) {
  const config = { ...settings.config, ...variant?.config };

  return {
    ...settings,
    ...variant,
    config: Object.keys(config).length > 0 ? config : undefined,
  };
}

function variantEntry(
  body: AgentDefinitionBody,
  repo: string,
): VariantEntry | undefined {
  const found = Object.entries(body.variants ?? {}).find(
    ([key]) => canonicalRepo(key) === canonicalRepo(repo),
  );

  return found ? { key: found[0], variant: found[1] } : undefined;
}

/** A repo's name as the floor matches it: case-insensitive, with or without a host. */
function canonicalRepo(repo: string): string {
  return repo.toLowerCase().replace(HOST_PREFIX, "");
}

/** The body with the repo's variant replaced under the key it already had; an empty variant, and then an empty map, is left out. */
function withVariant(
  body: AgentDefinitionBody,
  repo: string,
  variant: Variant,
): AgentDefinitionBody {
  const key = variantEntry(body, repo)?.key ?? variantKey(repo);
  const { [key]: _replaced, ...others } = body.variants ?? {};
  const variants =
    Object.keys(variant).length > 0 ? { ...others, [key]: variant } : others;

  return Object.keys(variants).length > 0
    ? { settings: body.settings, variants }
    : { settings: body.settings };
}

/** The floor matches a variant against the run's `host/owner/name`, so a new variant is keyed with the host. */
function variantKey(repo: string): string {
  return `${GITHUB_HOST}/${canonicalRepo(repo)}`;
}

/** A field patched to a value sets it, to null removes it, left undefined keeps it. */
function patched(
  target: Variant,
  patch: Patch,
  podResources: PodResourcesWrite | undefined,
): Variant {
  const fields = Object.entries(FLOOR_FIELDS).reduce(
    (next, [field, key]) => withField(next, key, patch[field as keyof Patch]),
    target,
  );

  return podResources ? withPodResources(fields, podResources) : fields;
}

function withField<Target extends object>(
  target: Target,
  key: string,
  value: unknown,
): Target {
  if (value === undefined) {
    return target;
  }
  const rest = Object.fromEntries(
    Object.entries(target).filter(([named]) => named !== key),
  ) as Target;

  return value === null ? rest : { ...rest, [key]: value };
}

function withPodResources(target: Variant, write: PodResourcesWrite): Variant {
  const config = withField(
    target.config ?? {},
    "pod_resources",
    write.podResources,
  );

  return withField(
    target,
    "config",
    Object.keys(config).length > 0 ? config : null,
  );
}
