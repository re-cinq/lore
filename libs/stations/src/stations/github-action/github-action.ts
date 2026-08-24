// The github_action station: gate on the repo's real GitHub Actions conclusion
// (ADR-031 D3). The pod polls the branch's CI conclusion over the Lore API
// (createStationProject → pulls.ciConclusion, server-side GitHub) until it is
// terminal or the poll budget runs out, then maps it to the node outcome. The
// pod's own Station deadline is the hard stop; this bound keeps the pod from
// out-waiting it. `none` (no CI configured) passes so the line isn't blocked.

import { ciOutcome, type NodeResult } from "@re-cinq/lore-assembly-lines";
import { createStationProject } from "@re-cinq/lore-shared";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { StationEnv } from "../../lib/station.js";

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 240; // ~1h at 15s; the Station deadline usually fires first

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runGithubActionStation(
  input: StationInput,
  _env?: StationEnv,
  deps: { sleep?: (ms: number) => Promise<void>; maxPolls?: number } = {},
): Promise<NodeResult> {
  const project = createStationProject(input.repo);
  const wait = deps.sleep ?? sleep;
  const maxPolls = deps.maxPolls ?? MAX_POLLS;

  for (let poll = 0; poll < maxPolls; poll++) {
    const conclusion = await project.pulls.ciConclusion(input.branch);
    const outcome = ciOutcome(conclusion);

    if (outcome) {
      return { outcome, extras: { "Lore-CI-Conclusion": conclusion } };
    }
    await wait(POLL_INTERVAL_MS);
  }

  return {
    outcome: "failed",
    extras: {
      "Lore-CI-Conclusion": "timeout",
      "Lore-Validation-Status": "ci-timeout",
    },
  };
}
