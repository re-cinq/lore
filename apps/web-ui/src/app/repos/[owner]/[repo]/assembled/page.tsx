export const dynamic = "force-dynamic";
import AssembledContextPanel from './AssembledContextPanel';

export default async function RepoAssembled({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return <AssembledContextPanel owner={owner} repo={repo} />;
}
