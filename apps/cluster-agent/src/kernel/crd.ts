// The custom resources this cluster acts on, named once — GROUP/VERSION come from @re-cinq/agent-contracts so an API-version bump arrives with the package, not a six-file grep.

import { GROUP, VERSION } from "@re-cinq/agent-contracts";

export { GROUP, VERSION };

export const AGENT_PLURAL = "agents";
export const AGENT_DEFINITION_PLURAL = "agentdefinitions";
export const STATION_PLURAL = "stations";

/** The `group/version` an Agent CR body carries as its `apiVersion`. */
export const AGENT_API_VERSION = `${GROUP}/${VERSION}`;
