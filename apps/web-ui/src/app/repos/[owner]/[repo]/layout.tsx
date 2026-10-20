import { getRepoMeta } from "@/lib/github";
import { getRepo } from "@/lib/api/repos";
import TabNav from "./TabNav";
import RepoHeader from "./RepoHeader";
import styles from "./layout.module.css";

interface RepoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoLayout(props: RepoLayoutProps) {
  const { owner, repo } = await props.params;
  const base = `/repos/${owner}/${repo}`;
  const { meta, record } = await readHeader(`${owner}/${repo}`);

  return (
    <div>
      <RepoHeader
        owner={owner}
        repo={repo}
        description={meta?.description}
        record={record}
      />
      <TabNav tabs={repoTabs(base)} base={base} />
      <div className={styles.body}>{props.children}</div>
    </div>
  );
}

/** The GitHub description and Lore's record, both fail-soft: a header that cannot read either still names the repo and keeps its tabs. */
async function readHeader(fullName: string) {
  const [meta, record] = await Promise.all([
    getRepoMeta(fullName).catch(() => null),
    getRepo(fullName)
      .then((r) => (r.status === "ok" ? r.data : null))
      .catch(() => null),
  ]);

  return { meta, record };
}

/** Every tab a repo has, in the order they are shown. Reads as the repo's table of contents, so the order is deliberate rather than alphabetical: what a reader wants first comes first. */
function repoTabs(base: string) {
  return [
    { href: base, label: "Overview" },
    { href: `${base}/tasks`, label: "Assembly Runs" },
    { href: `${base}/context`, label: "Context" },
    { href: `${base}/assembled`, label: "Assembled" },
    { href: `${base}/specs`, label: "Specs" },
    { href: `${base}/plans`, label: "Plans" },
    { href: `${base}/implementation-loop`, label: "Backlog" },
    { href: `${base}/triage`, label: "Triage" },
    { href: `${base}/adrs`, label: "ADRs" },
    { href: `${base}/graph`, label: "Graph" },
    { href: `${base}/agents`, label: "Agents" },
    { href: `${base}/settings`, label: "Settings" },
  ];
}
