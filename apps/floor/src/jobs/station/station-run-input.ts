/** The write-time caps on a station run's stored input. It lives with the station because the shape is the station's, not the walk's: the walk builds one to dispatch, and the CR backend builds one for a single-CR task. */

import type { StationRunInput } from "@re-cinq/lore-shared/models/station-run.js";
import { truncateForStorage } from "../lib/truncate-for-storage.js";

export const INPUT_DESCRIPTION_MAX_BYTES = 4_096;
export const INPUT_PROMPT_MAX_BYTES = 16_384;
export const INPUT_PARAM_MAX_BYTES = 1_024;

export function boundedStationRunInput(input: {
  description: string;
  prompt: string | null;
  repo: string;
  ref: string;
}): StationRunInput {
  return {
    description: truncateForStorage(
      input.description,
      INPUT_DESCRIPTION_MAX_BYTES,
    ),
    prompt:
      input.prompt === null
        ? null
        : truncateForStorage(input.prompt, INPUT_PROMPT_MAX_BYTES),
    // An agent visit runs a prompt, not a command.
    params: null,
    repo: input.repo,
    ref: input.ref,
  };
}
