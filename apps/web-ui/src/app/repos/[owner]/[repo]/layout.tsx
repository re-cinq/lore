import { getRepoMeta } from '@/lib/github';
import TabNav from './TabNav';
import styles from './layout.module.css';

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
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/tasks`, label: 'Tasks' },
    { href: `${base}/context`, label: 'Context' },
    { href: `${base}/assembled`, label: 'Assembled' },
    { href: `${base}/specs`, label: 'Specs' },
    { href: `${base}/features`, label: 'Features' },
    { href: `${base}/adrs`, label: 'ADRs' },
    { href: `${base}/graph`, label: 'Graph' },
    { href: `${base}/agents`, label: 'Agents' },
    { href: `${base}/dark-factory`, label: 'Dark Factory' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  return (
    <div>
      <h1 className={styles.title}>{owner}/{repo}</h1>
      {meta?.description && (
        <p className={`meta ${styles.desc}`}>{meta.description}</p>
      )}
      <TabNav tabs={tabs} base={base} />
      <div className={styles.body}>
        {children}
      </div>
    </div>
  );
}
