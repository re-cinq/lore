import { fillDescription } from "./config.js";

/** Build the task prompt from a resolved agent definition: substitute the description into its own prompt if it has one, else fall back to the yaml-derived template. Pure so both callers share one derivation. */
export function agentPrompt(
  prompt: string | null | undefined,
  description: string,
  fallback: string,
): string {
  return prompt ? fillDescription(prompt, description) : fallback;
}
