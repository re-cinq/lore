import { Alert } from "@/components/Alert";
import {
  getImplementationLoop,
  type ImplementationLoop,
} from "@/lib/api/backlog";
import type { ApiResult } from "@/lib/api/result";
import ImplementationLoopView from "./ImplementationLoopView";
import LoopRunsFollower from "./LoopRunsFollower";
import { retryOnboardingAction } from "../actions";

/** The implementation loop's page under its switch: the read, the live follower, and the pure view. */
export default async function ImplementationLoopBody({
  fullName,
}: {
  fullName: string;
}) {
  const result = await getImplementationLoop(fullName);

  // API failure must not masquerade as disabled loop with empty backlog.
  if (result.status !== "ok") {
    return <LoadFailure result={result} />;
  }

  return (
    <>
      <LoopRunsFollower runIds={runIdsOf(result.data)} />
      <ImplementationLoopView
        loop={result.data}
        retryOnboarding={retryOnboardingAction.bind(null, fullName)}
      />
    </>
  );
}

/** Every run id the page currently shows a Stages column for, so the live follower watches exactly those and nothing else. */
function runIdsOf(loop: ImplementationLoop): string[] {
  const tickets = [
    ...loop.current,
    ...loop.next,
    ...loop.parked,
    ...loop.recent,
    ...loop.awaiting_merge,
  ];
  const ids = tickets
    .map((t) => t.run_id)
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

/** Names the connection rather than the symptom, because an unreachable API and an empty backlog look the same on the page. */
function LoadFailure({
  result,
}: {
  result: Exclude<ApiResult<ImplementationLoop>, { status: "ok" }>;
}) {
  const reason =
    result.status === "error" ? result.message : "Lore API unconfigured";

  return (
    <Alert variant="secondary">
      Could not load the backlog state ({reason}) — check the Lore API
      connection and reload.
    </Alert>
  );
}
