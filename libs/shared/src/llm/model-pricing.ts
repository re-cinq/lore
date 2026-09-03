/** $/token for one model — shape shared between vendor pricing tables, each vendor still owns its own rates. */
export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}
