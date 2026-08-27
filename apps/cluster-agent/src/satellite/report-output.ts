import type { ClusterAgentIdentity } from "./identity-store.js";

/**
 * The reporting half of the claim (FR4 of
 * specs/running-stations-in-any-k8s-cluster): POST what a finished visit
 * printed, back up the same outbound channel the claim came down.
 *
 * The Floor cannot fetch this: a satellite is pull-based and carries no URL in
 * the registry, so its Agent CRs are unreadable from the centre. Nothing
 * dialled inward has ever worked, which is why the result travels outward.
 *
 * The identity is resolved PER CALL, like the heartbeat's: a re-registration
 * rotates the token, and a captured one 401s every report after it.
 */

export interface ReportOutputDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  fetchImpl?: typeof fetch;
}

/** A `reportOutput` for the watch — throws on refusal; the watch logs it. */
export function reportTerminalOutput(
  deps: ReportOutputDeps,
): (stationRunId: string, output: string) => Promise<void> {
  return async (stationRunId, output) => {
    const { id, token } = deps.identity();
    const res = await (deps.fetchImpl ?? fetch)(
      `${deps.apiUrl}/api/cluster-agents/${id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ station_run_id: stationRunId, output }),
      },
    );

    if (res.status !== 204) {
      throw new Error(`terminal output report refused: HTTP ${res.status}`);
    }
  };
}
