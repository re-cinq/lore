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
  const loop =
    result.status === "ok"
      ? result.data
      : { enabled: false, current: null, next: [], recent: [] };

  return (
    <ImplementationLoopView
      loop={loop}
      toggle={toggleImplementationLoopAction.bind(null, fullName)}
    />
  );
}
