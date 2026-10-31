// An agent is declared once, in libs/shared/src/agent-defaults/<definition>.md: its frontmatter the settings, its body the prompt. A pipeline file only names it from a station, and gets its definition here before the floor sees it (#3995).

import { enforceTrue } from "../../../lib/enforce.js";
import {
  floorSettingsOf,
  type FloorAgentSettings,
} from "../../../domain/agent-defaults/agent-default-file.js";
import { loadAgentDefaultFiles } from "./agent-defaults-files.js";

export type { FloorAgentSettings };

export interface PipelineDocument {
  line?: unknown;
  stations?: Record<string, { agent_definition?: string }> | null;
  agent_definitions?: Record<string, unknown> | null;
}

export type FloorAgents = ReadonlyMap<string, FloorAgentSettings>;

export type AgentPrompts = ReadonlyMap<string, string | null>;

export function shippedFloorAgents(): FloorAgents {
  return new Map(
    loadAgentDefaultFiles().map((file) => [file.name, floorSettingsOf(file)]),
  );
}

export function shippedAgentPrompts(): AgentPrompts {
  return new Map(
    [...shippedFloorAgents()].map(([name, agent]) => [name, agent.prompt]),
  );
}

/** Adds an `agent_definitions` entry, built from its .md file alone, for every agent a station names. */
export function withAgentDefinitions<Document extends PipelineDocument>(
  document: Document,
  agents: FloorAgents = shippedFloorAgents(),
): Document {
  enforceTrue(
    document.agent_definitions === undefined,
    Error,
    "a pipeline file carries an agent_definitions block; an agent's settings live in libs/shared/src/agent-defaults/<definition>.md",
  );
  const named = namedAgents(document);

  if (named.length === 0) {
    return document;
  }

  return {
    ...document,
    agent_definitions: Object.fromEntries(
      named.map((name) => [name, { settings: settingsOf(name, agents) }]),
    ),
  };
}

function namedAgents(document: PipelineDocument): string[] {
  const names = Object.values(document.stations ?? {}).map(
    (station) => station.agent_definition,
  );

  return [
    ...new Set(names.filter((name): name is string => name !== undefined)),
  ];
}

function settingsOf(name: string, agents: FloorAgents): FloorAgentSettings {
  const agent = agents.get(name);

  enforceTrue(
    agent?.prompt,
    Error,
    `agent definition ${name} has no prompt: libs/shared/src/agent-defaults/${name}.md is missing or has no body`,
  );

  return agent;
}
