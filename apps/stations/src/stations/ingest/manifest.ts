import type { NodeStationModule } from "../lib/station.js";
import { join } from "node:path";

/**
 * Project one internal.ingest.* payload into the graph.
 *
 * Runtime — A pod: it reads the init container's clone and is the ONLY workload granted
 *  graph-store egress, which a pooled service must not inherit.
 */
export const ingest: NodeStationModule = {
  manifest: {
    name: "ingest",
    description: "Project one internal.ingest.* payload into the graph.",
    triggers: [
      {
        kind: "node",
        nodeType: "ingest",
        runtime: "pod",
        clone: true,
        outcomes: ["success", "failed"],
        timeoutMinutes: 10,
      },
    ],
  },
  // The clone the init container made lives at <workspace>/target, not at the
  // workspace root — the adapter the old runner map carried.
  run: async (input, env) =>
    (await import("./ingest.js")).runIngestStation(input, {
      workspaceDir: join(env.workspaceDir, "target"),
    }),
};
