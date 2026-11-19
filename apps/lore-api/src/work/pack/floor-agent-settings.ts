import type { AgentDefinitionBody, AgentSettings } from "@re-cinq/floor-client";
import type { FloorAgentSettings } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";

type PackPrices = NonNullable<FloorAgentSettings["prices"]>;
type FloorPrices = NonNullable<AgentSettings["prices"]>;

/** An agent's settings as an md file writes them, in the keys the floor stores them under. */
export function floorSettingsOf(settings: FloorAgentSettings): AgentSettings {
  return {
    ...(settings.model && { model: settings.model }),
    prompt: settings.prompt as string,
    image: settings.image as string,
    timeoutMinutes: settings.timeout_minutes as number,
    ...(settings.config && { config: settings.config }),
    ...(settings.prices && { prices: floorPricesOf(settings.prices) }),
  };
}

export function floorPricesOf(prices: PackPrices): FloorPrices {
  return Object.fromEntries(
    Object.entries(prices).map(([model, price]) => [
      model,
      {
        inputPerMillion: price.input_per_million,
        outputPerMillion: price.output_per_million,
        ...(price.cache_read_per_million !== undefined && {
          cacheReadPerMillion: price.cache_read_per_million,
        }),
      },
    ]),
  );
}

/** What a run reads of an org default on the floor, in the keys the pack writes. */
export function packSettingsOf(settings: AgentSettings): FloorAgentSettings {
  return {
    ...(settings.model && { model: settings.model }),
    image: settings.image,
    timeout_minutes: settings.timeoutMinutes,
    ...(settings.config && { config: settings.config }),
    prompt: settings.prompt,
  } as FloorAgentSettings;
}

/** The body to put for an agent: the pack's settings as the org default, whatever repository variants the floor holds kept. */
export function agentBodyOf(
  held: AgentDefinitionBody | undefined,
  settings: FloorAgentSettings,
): AgentDefinitionBody {
  return { ...held, settings: floorSettingsOf(settings) };
}
