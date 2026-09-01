/** $/token for one model, shared shape between vendor pricing tables
 *  (`anthropic-provider.ts`, `gemini-provider.ts`) — each vendor still owns
 *  its own rates, only the shape is common. */
export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}
