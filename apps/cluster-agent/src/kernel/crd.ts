/**
 * The custom resources this cluster acts on, named once.
 *
 * `GROUP` and `VERSION` come from `@re-cinq/agent-contracts`, which is the
 * subsystem's own declaration of them — so an API-version bump arrives with the
 * package rather than waiting to be found by grep in six files. Getting that
 * wrong does not fail to compile: the claim would create CRs at one version
 * while the watch listed another, and every node would wait for the reaper.
 */

import { GROUP, VERSION } from "@re-cinq/agent-contracts";

export { GROUP, VERSION };

export const AGENT_PLURAL = "agents";
export const AGENT_DEFINITION_PLURAL = "agentdefinitions";
export const STATION_PLURAL = "stations";

/** The `group/version` an Agent CR body carries as its `apiVersion`. */
export const AGENT_API_VERSION = `${GROUP}/${VERSION}`;
