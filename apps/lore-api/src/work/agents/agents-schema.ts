import { z } from "zod";
import type { AgentDefinitionInput } from "@re-cinq/lore-shared";
import { SKILL_NAME } from "@re-cinq/lore-shared/models/skill-definition.js";

// Agents API validation; image is two-key-gated (imageFieldTouched flag).

// Kubernetes resource quantity validated at edge to catch typos early.
const QUANTITY = /^\d+(\.\d+)?(m|[kKMGTPE]i?)?$/;
const PodResourcesSchema = z.object({
  requests: z.record(z.string(), z.string().regex(QUANTITY)).optional(),
  limits: z.record(z.string(), z.string().regex(QUANTITY)).optional(),
});

export type PodResources = z.infer<typeof PodResourcesSchema>;

// A header or env var an MCP server needs, valued from the key `ref` of the cluster's agent-secrets.
const SecretRefSchema = z.object({
  name: z.string().min(1).max(128),
  ref: z.string().min(1).max(253),
});

// The floor's own shape (re-cinq/floor agent-config.ts), checked here so a typo answers 400 instead of a failed floor put.
const McpServerSchema = z
  .object({
    name: z.string().min(1).max(64),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.url().optional(),
    headers_secret: z.string().min(1).optional(),
    headers: z.array(SecretRefSchema).optional(),
    env: z.array(SecretRefSchema).optional(),
  })
  .refine(
    (server) =>
      server.transport === "stdio"
        ? Boolean(server.command)
        : Boolean(server.url),
    { message: "a stdio server needs a command, any other a url" },
  );

export type McpServer = z.infer<typeof McpServerSchema>;

const ExecutionMode = z.enum(["claude-code", "graph-ingest", "station"]);

export const AgentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase kebab-case"),
  model: z.string().min(1).max(128).nullish(),
  timeout_minutes: z.number().int().positive().max(1440).nullish(),
  prompt: z.string().max(20000).nullish(),
  image: z.string().max(512).nullish(),
  execution_mode: ExecutionMode.default("claude-code"),
  review_required: z.boolean().default(false), // eslint-disable-line re-lint/no-flag-params -- a zod default VALUE, not a flag argument
  pod_resources: PodResourcesSchema.nullish(),
  mcp_servers: z.array(McpServerSchema).max(32).nullish(),
  skills: z.array(z.string().regex(SKILL_NAME)).max(32).nullish(),
  adjust_skill_models: z.boolean().nullish(),
});

/** The config keys the Agents UI owns, each its own field on the body. */
export type OwnedConfigKey =
  "pod_resources" | "mcp_servers" | "skills" | "adjust_skill_models";

// POST body: row fields + pod_resources; route merges over inherited config (org → yaml).
export type AgentCreate = AgentDefinitionInput & {
  pod_resources?: PodResources;
  mcp_servers?: McpServer[];
  skills?: string[];
  adjust_skill_models?: boolean;
};

const adjustSkillModelsField = (
  p: Pick<z.infer<typeof AgentInputSchema>, "adjust_skill_models">,
): Pick<AgentPatch, "adjust_skill_models"> =>
  p.adjust_skill_models == null
    ? {}
    : { adjust_skill_models: p.adjust_skill_models };

// Only what the create names: an absent or empty value is left to the inherited config.
function ownedConfigOf(
  p: z.infer<typeof AgentInputSchema>,
): Pick<AgentCreate, OwnedConfigKey> {
  return {
    ...(p.pod_resources ? { pod_resources: p.pod_resources } : {}),
    ...(p.mcp_servers?.length ? { mcp_servers: p.mcp_servers } : {}),
    ...(p.skills?.length ? { skills: p.skills } : {}),
    ...adjustSkillModelsField(p),
  };
}

const normalize = (p: z.infer<typeof AgentInputSchema>): AgentCreate => ({
  name: p.name,
  model: p.model ?? null,
  timeout_minutes: p.timeout_minutes ?? null,
  prompt: p.prompt ?? null,
  image: p.image ?? null,
  execution_mode: p.execution_mode,
  review_required: p.review_required,
  // config not settable (catalog seed); only pod_resources.
  config: null,
  ...ownedConfigOf(p),
});

export function parseAgentInput(body: unknown): AgentCreate {
  return normalize(AgentInputSchema.parse(body));
}

// PUT body: row fields + separate pod_resources; adapter merges over inherited layer config.
export type AgentPatch = Partial<AgentDefinitionInput> & {
  pod_resources?: PodResources | null;
  mcp_servers?: McpServer[] | null;
  skills?: string[] | null;
  adjust_skill_models?: boolean;
};

/** The config keys a patch names, under the adapter's names. An empty list stays a list: in a repo's variant it means "none", where null means "the org default's". */
export function configKeysOf(patch: Pick<AgentPatch, OwnedConfigKey>): {
  podResources?: PodResources | null;
  mcpServers?: McpServer[] | null;
  skills?: string[] | null;
  adjustSkillModels?: boolean;
} {
  const {
    pod_resources: podResources,
    mcp_servers: mcpServers,
    skills,
    adjust_skill_models: adjustSkillModels,
  } = patch;

  return {
    ...(podResources === undefined ? {} : { podResources }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    ...(skills === undefined ? {} : { skills }),
    ...(adjustSkillModels === undefined ? {} : { adjustSkillModels }),
  };
}

// A patch must not invent values: zod 4 applies an inner .default() through .partial(), turning an omitted field into a silent write.
const AgentPatchSchema = AgentInputSchema.partial().extend({
  execution_mode: ExecutionMode.optional(),
  review_required: z.boolean().optional(),
});

type ParsedAgentPatch = z.infer<typeof AgentPatchSchema>;

const nameField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.name !== undefined ? { name: p.name } : {};

const modelField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.model !== undefined ? { model: p.model ?? null } : {};

const timeoutMinutesField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.timeout_minutes !== undefined
    ? { timeout_minutes: p.timeout_minutes ?? null }
    : {};

const promptField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.prompt !== undefined ? { prompt: p.prompt ?? null } : {};

const imageField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.image !== undefined ? { image: p.image ?? null } : {};

const executionModeField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.execution_mode !== undefined ? { execution_mode: p.execution_mode } : {};

const reviewRequiredField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.review_required !== undefined ? { review_required: p.review_required } : {};

const podResourcesField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.pod_resources !== undefined
    ? { pod_resources: p.pod_resources ?? null }
    : {};

const mcpServersField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.mcp_servers !== undefined ? { mcp_servers: p.mcp_servers ?? null } : {};

const skillsField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.skills !== undefined ? { skills: p.skills ?? null } : {};

export function parseAgentPatch(body: unknown): AgentPatch {
  const parsed = AgentPatchSchema.parse(body);

  return {
    ...nameField(parsed),
    ...modelField(parsed),
    ...timeoutMinutesField(parsed),
    ...promptField(parsed),
    ...imageField(parsed),
    ...executionModeField(parsed),
    ...reviewRequiredField(parsed),
    ...podResourcesField(parsed),
    ...mcpServersField(parsed),
    ...skillsField(parsed),
    ...adjustSkillModelsField(parsed),
  };
}

// Merge pod_resources into config; empty result → null → fall through to org layer.
export function configWithPodResources(
  existing: Record<string, unknown> | null,
  podResources: PodResources | null,
): Record<string, unknown> | null {
  const { pod_resources: _replaced, ...rest } = existing ?? {};
  const next = podResources ? { ...rest, pod_resources: podResources } : rest;

  return Object.keys(next).length > 0 ? next : null;
}

/** Image is two-key gated (ADR-025): a write that sets a non-empty image needs the approval PR. */
export function imageFieldTouched(input: { image?: string | null }): boolean {
  const { image } = input;

  return typeof image === "string" && image.trim().length > 0;
}
