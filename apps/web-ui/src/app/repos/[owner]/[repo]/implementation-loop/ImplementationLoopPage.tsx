import { getImplementationLoop } from "@/lib/api/backlog";
import ImplementationLoopView from "./ImplementationLoopView";
import { toggleImplementationLoopAction } from "./actions";

export default async function ImplementationLoopPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const result = await getImplementationLoop(fullName);

  // An API failure must not masquerade as a disabled loop with an empty
  // backlog — say what actually happened.
  if (result.status !== "ok") {
    return (
      <p className="meta">
        Could not load the backlog state (
        {result.status === "error" ? result.message : "Lore API unconfigured"})
        — check the Lore API connection and reload.
      </p>
    );
  }

  return (
    <ImplementationLoopView
      loop={result.data}
      toggle={toggleImplementationLoopAction.bind(null, fullName)}
    />
  );
}
