/** Resolve the station a blueprint's node type dispatches to. */

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
