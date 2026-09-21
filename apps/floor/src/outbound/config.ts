/** Prompt helpers for the Floor's dispatches: every recipe body comes from the resolved lore.agent_definitions row (project → org). */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** The prompt a task gets when its resolved definition carries none — a task type with no row still dispatches. */
export function defaultTaskPrompt(description: string): string {
  return fillDescription(
    "Complete the following task: {description}",
    description,
  );
}

/** Substitute a description into `{description}` LITERALLY via a replacer function, since `String.prototype.replace`'s string form interprets `$&`/`$'`/`$1` in user input (UI/Slack/Issue text) and silently corrupted the prompt. */
export function fillDescription(template: string, description: string): string {
  return template.replace("{description}", () => description);
}

/** The prompt for an assembly-line node, from the RESOLVED recipe's body (project row → org row → yaml, `agentDefs.resolve`) — STRICT: a ref that resolves to no recipe, or to one with no prompt, throws rather than running another recipe; a silent fallback once let every push node quietly run the wrong prompt and report success for weeks with no PR opened (#1329). */
export function renderNodePrompt(
  promptRef: string,
  recipePrompt: string | null | undefined,
  description: string,
): string {
  enforceTrue(
    typeof recipePrompt === "string" && recipePrompt.length > 0,
    Error,
    `no prompt named "${promptRef}" — an assembly-line node names a recipe that does not exist or carries no prompt`,
  );

  return fillDescription(recipePrompt, description);
}
