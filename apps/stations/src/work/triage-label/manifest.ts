import type { SweepStationModule } from "../lib/station.js";

export const triageLabel: SweepStationModule = {
  manifest: {
    name: "triage-label",
    description:
      "Apply the triage:* label matching a node outcome to the issue.",
    triggers: [{ kind: "http" }],
  },
  run: async () => "triage-label: invoked via floor service station",
};
