/**
 * Resolve the station a blueprint's node type dispatches to.
 *
 * A blueprint names a node TYPE (`github_action`); a station is filed under its
 * folder NAME (`github-action`). The two coincide for six of the eight and
 * differ by an underscore for the rest — which is the near-miss that made the
 * old parallel lists fail at runtime instead of at compile time. Resolving
 * through the manifest means the mapping is declared once, by the station.
 */

import { STATIONS } from "./registry.js";
import {
  isNodeModule,
  nodeTriggers,
  type NodeStationModule,
} from "./lib/station.js";

const byNodeType = new Map<string, NodeStationModule>(
  Object.values(STATIONS)
    .filter(isNodeModule)
    .flatMap((mod) =>
      nodeTriggers(mod.manifest).map(
        (t) => [t.nodeType, mod] as [string, NodeStationModule],
      ),
    ),
);

/** The station for this node type, or undefined when none claims it. */
export const nodeStationFor = (
  nodeType: string,
): NodeStationModule | undefined => byNodeType.get(nodeType);
