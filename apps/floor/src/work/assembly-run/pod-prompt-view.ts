// The POD's side of a dispatch, for tests: what the model receives once the subsystem renders the catalog template with the Agent CR's parameters. `spec.prompt` is only what the Floor SENT — asserting on it alone is how #2051 (a template that never rendered that parameter) stayed green for weeks.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { agentDefToCrds } from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import {
  agentParameters,
  renderPodPrompt,
} from "@re-cinq/lore-shared/cluster/agent-backend.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";

/** What the pod's model receives for a dispatched spec. */
export function podPromptOf(spec: LoreTaskSpec): string {
  const { agentDefinition } = agentDefToCrds(catalogRowFor(spec), {
    mcpUrl: "https://mcp.example",
  });
  const template = agentDefinition.spec?.prompt;

  enforceTrue(
    typeof template === "string",
    Error,
    "LLM recipe has no template",
  );

  return renderPodPrompt(template, agentParameters(spec));
}

/** A catalog row for the spec's recipe; the body is deliberately NOT what the Floor sent, so a template that rendered the body instead of the parameter is visible in the result. */
function catalogRowFor(spec: LoreTaskSpec): ResolvedAgentDefinition {
  return {
    name: spec.taskType,
    model: null,
    timeout_minutes: 30,
    prompt:
      "RECIPE BODY — rendered by the Floor into the prompt parameter, never by the pod",
    image: null,
    execution_mode: "claude-code",
    review_required: false,
    project_id: null,
    config: null,
  };
}
