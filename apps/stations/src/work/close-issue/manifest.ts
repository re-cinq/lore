import type { SweepStationModule } from "../lib/station.js";

/** Registry entry for the close-issue floor station (issue-triage FR15). The floor claims its work; this manifest satisfies the registry test's folder-coverage check. */
export const closeIssueStation: SweepStationModule = {
  manifest: {
    name: "close-issue",
    description:
      "Posts the triage verdict as a comment and closes the issue (issue-triage FR15).",
    triggers: [{ kind: "http" }],
  },
  run: async () => {
    throw new Error(
      "close-issue is a floor station — start it via startCloseIssueStation(), not the sweep runner",
    );
  },
};
