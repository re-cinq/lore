import { getRepoMeta } from "@/lib/github";
import { getRepo } from "@/lib/api/repos";
import TabNav from "./TabNav";
import RepoHeader from "./RepoHeader";
import RepoChrome from "./RepoChrome";
import styles from "./layout.module.css";

interface RepoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoLayout(props: RepoLayoutProps) {
  const { owner, repo } = await props.params;
  const base = `/repos/${owner}/${repo}`;
  const header = await readHeader(`${owner}/${repo}`);

  return (
    <div>
      <RepoChrome
        base={base}
        fullName={`${owner}/${repo}`}
        full={fullChrome({ owner, repo, base, ...header })}
      />
      <div className={styles.body}>{props.children}</div>
    </div>
  );
}

interface FullChromeProps extends Awaited<ReturnType<typeof readHeader>> {
  owner: string;
  repo: string;
  base: string;
}

/** The repo header and tab bar every page but a single plan's shows. */
function fullChrome({ owner, repo, base, meta, record }: FullChromeProps) {
  return (
    <>
      <RepoHeader
        owner={owner}
        repo={repo}
        description={meta?.description}
        record={record}
      />
      <TabNav tabs={repoTabs(base)} base={base} />
    </>
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
    { href: `${base}/context`, label: "Context" },
    { href: `${base}/assembled`, label: "Assembled" },
    { href: `${base}/specs`, label: "Specs" },
    { href: `${base}/plans`, label: "Plans" },
    { href: `${base}/changelog`, label: "Changelog" },
    { href: `${base}/loops`, label: "Loops" },
    { href: `${base}/adrs`, label: "ADRs" },
    { href: `${base}/graph`, label: "Graph" },
    { href: `${base}/agents`, label: "Agents" },
    { href: `${base}/settings`, label: "Settings" },
  ];
}
