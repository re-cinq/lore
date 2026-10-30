// An agent's prompt lives in one place, libs/shared/src/agent-defaults/<definition>.md; a pipeline file names the agent and its settings, and gets the prompt here before the floor sees it.

import { enforceTrue } from "../../../lib/enforce.js";
import { loadAgentDefaults } from "./agent-defaults-files.js";

type Fields = Record<string, unknown>;

export interface PipelineDocument {
  line?: unknown;
  agent_definitions?: Record<string, Fields> | null;
}

/** What the floor is handed for one agent definition, as stored; a null field keeps the pipeline file's value, as null means inherit in lore.agent_definitions. Of the stored config only pod_resources is the agent's own: the rest (skills, test_policy) is a copy of the md frontmatter, while the pipeline file holds the real mcp_servers, skills and env. */
export interface StoredAgentSettings {
  prompt: string | null;
  model?: string | null;
  timeout_minutes?: number | null;
  image?: string | null;
  config?: Record<string, unknown> | null;
}

export type AgentPrompts = ReadonlyMap<string, StoredAgentSettings>;

const STORED_FIELDS = ["model", "timeout_minutes", "image"] as const;

export function shippedAgentPrompts(): AgentPrompts {
  return new Map(
    loadAgentDefaults().map((agent) => [agent.name, { prompt: agent.prompt }]),
  );
}

export function withAgentPrompts<Document extends PipelineDocument>(
  document: Document,
  prompts: AgentPrompts = shippedAgentPrompts(),
): Document {
  const definitions = document.agent_definitions;

  if (!definitions) {
    return document;
  }

  return {
    ...document,
    agent_definitions: Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => [
        name,
        withPrompt(name, definition, prompts),
      ]),
    ),
  };
}

function withPrompt(
  name: string,
  definition: Fields,
  prompts: AgentPrompts,
): Fields {
  const settings = (definition.settings ?? {}) as Fields;
  const stored = prompts.get(name);

  return {
    ...definition,
    settings: {
      ...settings,
      ...storedFields(stored),
      ...storedPodResources(settings, stored),
      prompt: requiredPrompt(name, settings, stored),
    },
  };
}

function requiredPrompt(
  name: string,
  settings: Fields,
  stored: StoredAgentSettings | undefined,
): string {
  const source = `libs/shared/src/agent-defaults/${name}.md`;
  const prompt = stored?.prompt;

  enforceTrue(
    settings.prompt === undefined,
    Error,
    `agent definition ${name} carries an inline prompt; its prompt is ${source}`,
  );
  enforceTrue(
    prompt,
    Error,
    `agent definition ${name} has no prompt: ${source} is missing or has no body`,
  );

  return prompt;
}

function storedFields(stored: StoredAgentSettings | undefined): Fields {
  return Object.fromEntries(
    STORED_FIELDS.flatMap((field) =>
      stored?.[field] == null ? [] : [[field, stored[field]]],
    ),
  );
}

function storedPodResources(
  settings: Fields,
  stored: StoredAgentSettings | undefined,
): Fields {
  const podResources = stored?.config?.pod_resources;

  if (podResources == null) {
    return {};
  }

  return {
    config: {
      ...((settings.config ?? {}) as Fields),
      pod_resources: podResources,
    },
  };
}

/** One agent definition the floor holds differently from what is stored, by the fields that differ. */
export interface DefinitionDrift {
  name: string;
  fields: string[];
}

/** What the floor holds against what is stored, for every stored definition given: the prompt always, the other fields where one is stored, since a null field leaves the pipeline file's value standing. */
export function definitionDrift(
  stored: AgentPrompts,
  held: Array<{ id: string; body: { settings?: Fields } }>,
): DefinitionDrift[] {
  const heldById = new Map(
    held.map((row) => [row.id, row.body.settings ?? {}]),
  );

  return [...stored].flatMap(([name, settings]) => {
    const fields = driftedFields(settings, heldById.get(name) ?? {});

    return fields.length === 0 ? [] : [{ name, fields }];
  });
}

function driftedFields(stored: StoredAgentSettings, held: Fields): string[] {
  const compared = [
    "prompt",
    ...STORED_FIELDS.filter((field) => stored[field] != null),
  ] as const;

  return compared.filter((field) => stored[field] !== held[field]);
}
