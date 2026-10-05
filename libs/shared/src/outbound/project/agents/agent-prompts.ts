// An agent's prompt lives in one place, libs/shared/src/agent-defaults/<definition>.md; a pipeline file names the agent and its settings, and gets the prompt here before the floor sees it.

import { enforceTrue } from "../../../lib/enforce.js";
import { loadAgentDefaults } from "./agent-defaults-files.js";

type Fields = Record<string, unknown>;

export interface PipelineDocument {
  line?: unknown;
  agent_definitions?: Record<string, Fields> | null;
}

export type AgentPrompts = ReadonlyMap<string, string | null>;

export function shippedAgentPrompts(): AgentPrompts {
  return new Map(
    loadAgentDefaults().map((agent) => [agent.name, agent.prompt]),
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
  const source = `libs/shared/src/agent-defaults/${name}.md`;
  const prompt = prompts.get(name);

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

  return { ...definition, settings: { ...settings, prompt } };
}
