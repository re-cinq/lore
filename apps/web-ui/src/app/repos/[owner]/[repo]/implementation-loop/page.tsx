import { permanentRedirect } from "next/navigation";

/** The Backlog tab became the implementation loop of the Loops tab; links to the old address land on it. */
export default async function ImplementationLoopRedirect(props: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await props.params;

  permanentRedirect(`/repos/${owner}/${repo}/loops?loop=implementation`);
}
