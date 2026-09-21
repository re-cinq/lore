import NewPlanView from "./NewPlanView";
import { createPlanAction } from "./actions";

export default async function NewPlanPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;

  return (
    <NewPlanView action={createPlanAction.bind(null, `${owner}/${repo}`)} />
  );
}
