import { getRepoMeta } from "@/lib/github";
import TabNav from "./TabNav";
import styles from "./layout.module.css";

/** Every tab a repo has, in the order they are shown. Reads as the repo's table of contents, so the order is deliberate rather than alphabetical: what a reader wants first comes first. */
function repoTabs(base: string) {
  return [
    { href: base, label: "Overview" },
    { href: `${base}/tasks`, label: "Assembly Runs" },
    { href: `${base}/context`, label: "Context" },
    { href: `${base}/assembled`, label: "Assembled" },
    { href: `${base}/specs`, label: "Specs" },
    { href: `${base}/features`, label: "Features" },
    { href: `${base}/implementation-loop`, label: "Backlog" },
    { href: `${base}/adrs`, label: "ADRs" },
    { href: `${base}/graph`, label: "Graph" },
    { href: `${base}/agents`, label: "Agents" },
    { href: `${base}/dark-factory`, label: "Dark Factory" },
    { href: `${base}/settings`, label: "Settings" },
  ];
}

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const base = `/repos/${owner}/${repo}`;
  const meta = await getRepoMeta(`${owner}/${repo}`).catch(() => null);

  return (
    <div>
      <h1 className={styles.title}>
        {owner}/{repo}
      </h1>
      {meta?.description && (
        <p className={`meta ${styles.desc}`}>{meta.description}</p>
      )}
      <TabNav tabs={repoTabs(base)} base={base} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
