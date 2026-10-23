import { permanentRedirect } from "next/navigation";

/** The Triage tab became the issue-triage loop of the Loops tab; links to the old address land on it. */
export default async function TriageRedirect(props: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await props.params;

  permanentRedirect(`/repos/${owner}/${repo}/loops?loop=triage`);
}
