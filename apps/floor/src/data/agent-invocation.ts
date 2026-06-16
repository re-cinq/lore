/**
 * Build the task prompt from a resolved agent definition (project.agents): when
 * the definition carries its own prompt, substitute the task description into
 * it; otherwise fall back to the yaml-derived task-type template. Pure so both
 * the worker and the LoreTask handler share one derivation.
 */
export function agentPrompt(
  prompt: string | null | undefined,
  description: string,
  fallback: string,
): string {
  return prompt ? prompt.replace("{description}", description) : fallback;
}
