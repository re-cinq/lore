import { floorSettingsOf, readAgentDefaultFile } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  FloorAgents,
  FloorAgentSettings,
} from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { settingsWithEnvironment } from "../floor/seed-floor-pipelines.js";
import type { PackFile } from "./fetch-pack.js";
import { agentFileOf } from "./pack-paths.js";
import { attempt, type Refusal } from "./pack-refusal.js";

export interface ShippedCatalog {
  /** The names of the pipelines Lore ships. */
  pipelines: readonly string[];
  /** The shipped agents, their settings as the md files write them (environment not yet filled in). */
  agents: FloorAgents;
}

export interface PackOverlayInput {
  files: readonly PackFile[];
  shipped: ShippedCatalog;
  env: Record<string, string | undefined>;
}

export type AgentSource = "pack-new" | "replaced" | "extended";

export interface OverlayAgent {
  settings: FloorAgentSettings;
  source: AgentSource;
}

interface AgentFile extends PackFile {
  agent: string;
  isExtension: boolean;
}

const REQUIRED_SETTINGS = ["image", "timeout_minutes", "prompt"] as const;

/** The agents the pack sets, the first file to name an agent winning. */
export function agentsOverlay(input: PackOverlayInput) {
  const agents = new Map<string, OverlayAgent>();
  const setBy = new Map<string, string>();
  const refused: Refusal[] = [];

  for (const file of agentFilesOf(input.files)) {
    const result = attempt(file.path, () => agentOf(file, input, setBy));

    if ("refusal" in result) {
      refused.push(result.refusal);
      continue;
    }
    agents.set(file.agent, result.made);
    setBy.set(file.agent, file.path);
  }

  return { agents, refused };
}

function agentFilesOf(files: readonly PackFile[]): AgentFile[] {
  const agentFiles = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((file) => {
      const named = agentFileOf(file.path);

      return named ? [{ ...file, ...named }] : [];
    });

  // A full definition goes first, so an extension of the same agent is the one refused.
  return [
    ...agentFiles.filter((file) => !file.isExtension),
    ...agentFiles.filter((file) => file.isExtension),
  ];
}

function agentOf(
  file: AgentFile,
  { shipped, env }: PackOverlayInput,
  setBy: ReadonlyMap<string, string>,
): OverlayAgent {
  const base = shipped.agents.get(file.agent);

  enforceTrue(
    !setBy.has(file.agent),
    Error,
    `${file.agent} is already set by ${setBy.get(file.agent)}`,
  );

  return file.isExtension
    ? extendedAgent(file, base, env)
    : definedAgent(file, base, env);
}

function extendedAgent(
  file: AgentFile,
  base: FloorAgentSettings | undefined,
  env: PackOverlayInput["env"],
): OverlayAgent {
  enforceTrue(
    base,
    Error,
    `an extension needs a shipped agent, and nothing ships ${file.agent}`,
  );

  return {
    source: "extended",
    settings: settingsWithEnvironment(
      { ...base, prompt: `${base.prompt}\n\n${file.text}` },
      env,
    ),
  };
}

function definedAgent(
  file: AgentFile,
  base: FloorAgentSettings | undefined,
  env: PackOverlayInput["env"],
): OverlayAgent {
  const settings = floorSettingsOf(readAgentDefaultFile(file.agent, file.text));

  for (const field of REQUIRED_SETTINGS) {
    enforceTrue(
      settings[field],
      Error,
      `${file.agent} has no ${field}, and a full agent definition needs a prompt, an image and timeout_minutes`,
    );
  }

  return {
    source: base ? "replaced" : "pack-new",
    settings: settingsWithEnvironment(settings, env),
  };
}
