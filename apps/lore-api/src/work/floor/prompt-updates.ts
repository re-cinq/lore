// A prompt migration: `SELECT lore.update_prompt('<agent>', '<file>.md');` in a schema migration queues a row, and lore-api writes that shipped file's prompt as the agent's org default on the floor at boot. Boot seeding alone never overwrites an agent the floor holds (#3995), so a changed shipped prompt reaches the floor only this way.
import path from "node:path";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import type { SeedFailure } from "./seed-floor-pipelines.js";

export interface PromptUpdate {
  id: number;
  agent: string;
  file: string;
}

export interface PromptUpdateDeps {
  pending(): Promise<PromptUpdate[]>;
  /** The prompt of the shipped agent-defaults file of this name, without `.md`. */
  shippedPrompt(name: string): string | null | undefined;
  writePrompt(agent: string, prompt: string): Promise<void>;
  markApplied(id: number): Promise<void>;
}

export interface PromptUpdatesApplied {
  applied: string[];
  failed: SeedFailure[];
}

/** Applies every pending row in order. A row that fails stays pending for the next boot, and the rest are still applied. */
export async function applyPromptUpdates(
  deps: PromptUpdateDeps,
): Promise<PromptUpdatesApplied> {
  const outcome: PromptUpdatesApplied = { applied: [], failed: [] };

  for (const update of await deps.pending()) {
    try {
      await applyOne(deps, update);
      outcome.applied.push(update.agent);
    } catch (cause) {
      outcome.failed.push({
        name: update.agent,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return outcome;
}

async function applyOne(
  deps: PromptUpdateDeps,
  update: PromptUpdate,
): Promise<void> {
  const prompt = deps.shippedPrompt(path.basename(update.file, ".md"));

  enforceTrue(
    prompt,
    Error,
    `no shipped agent file ${update.file} has a prompt`,
  );

  await deps.writePrompt(update.agent, prompt);
  await deps.markApplied(update.id);
}

export function productionPromptUpdateDeps(
  pool: Pool,
  env: Record<string, string | undefined> = process.env,
): PromptUpdateDeps {
  const agentDefs = new FloorAgentDefs(floorClientFrom(env).agentDefinitions);
  const prompts = shippedAgentPrompts();

  return {
    ...queueOf(pool),
    shippedPrompt: (name) => prompts.get(name),
    writePrompt: async (agent, prompt) => {
      await agentDefs.updateOrg(agent, { prompt });
    },
  };
}

function queueOf(
  pool: Pool,
): Pick<PromptUpdateDeps, "pending" | "markApplied"> {
  return {
    pending: async () =>
      (
        await pool.query<PromptUpdate>(
          "SELECT id::int AS id, agent, file FROM lore.agent_prompt_updates WHERE applied_at IS NULL ORDER BY id",
        )
      ).rows,
    markApplied: async (id) => {
      await pool.query(
        "UPDATE lore.agent_prompt_updates SET applied_at = now() WHERE id = $1",
        [id],
      );
    },
  };
}
