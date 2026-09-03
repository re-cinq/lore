/** A response that names the run it started or polled, in either spelling. */
export interface RunIdCarrier {
  assembly_run_id?: string | null;
  assembly_line_id?: string | null;
}

/** Reads either spelling since lore-api/web-ui deploy independently (specs/6-dark-factory FR6.44); new key wins, `||` not `??` since an empty string is not a run id. */
export function runIdOf(response: RunIdCarrier): string | null {
  return response.assembly_run_id || response.assembly_line_id || null;
}
