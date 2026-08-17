/** A response that names the run it started or polled, in either spelling. */
export interface RunIdCarrier {
  assembly_run_id?: string | null;
  assembly_line_id?: string | null;
}

/**
 * The run id out of an API response, whichever spelling it arrived under.
 *
 * lore-api and web-ui are separate images in one umbrella release, so their
 * rollouts do not land together: this UI can be talking to a lore-api from
 * either side of the AssemblyRun rename (specs/6-dark-factory FR6.44). Reading
 * both is what lets the API move without a synchronised deploy.
 *
 * The new key wins so that the day the deprecated one is dropped is a no-op here
 * rather than a regression. Delete the fallback once no deployed lore-api emits
 * only the old key.
 *
 * `||`, not `??`: an empty string is not a run id. It would satisfy `??` and then
 * be handed to the run read as if it named something, which fails as a missing
 * run rather than as the malformed response it is — so it falls through to the
 * fallback and finally to null, the same as absent.
 */
export function runIdOf(response: RunIdCarrier): string | null {
  return response.assembly_run_id || response.assembly_line_id || null;
}
