import { Alert } from "@/components/Alert";
import { getImplementationLoop } from "@/lib/api/backlog";
import ImplementationLoopView from "./ImplementationLoopView";
import {
  retryOnboardingAction,
  toggleImplementationLoopAction,
} from "./actions";

interface LoopPageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function ImplementationLoopPage(props: LoopPageProps) {
  const { owner, repo } = await props.params;
  const fullName = `${owner}/${repo}`;
  const result = await getImplementationLoop(fullName);

  // API failure must not masquerade as disabled loop with empty backlog.
  if (result.status !== "ok") {
    const reason =
      result.status === "error" ? result.message : "Lore API unconfigured";

    return <LoadFailure reason={reason} />;
  }

  return (
    <ImplementationLoopView
      loop={result.data}
      toggle={toggleImplementationLoopAction.bind(null, fullName)}
      retryOnboarding={retryOnboardingAction.bind(null, fullName)}
    />
  );
}

/** Names the connection rather than the symptom, because an unreachable API and an empty backlog look the same on the page. */
function LoadFailure({ reason }: { reason: string }) {
  return (
    <Alert variant="secondary">
      Could not load the backlog state ({reason}) — check the Lore API
      connection and reload.
    </Alert>
  );
}
