import { getRepoMeta } from '@/lib/github';
import TabNav from './TabNav';

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
    { href: `${base}/agents`, label: 'Agents' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  return (
    <div>
      <h1 style={{marginBottom:'4px'}}>{owner}/{repo}</h1>
      {meta?.description && (
        <p className="meta" style={{marginTop:0, marginBottom:'12px'}}>{meta.description}</p>
      )}
      <TabNav tabs={tabs} base={base} />
      <div style={{marginTop:'16px'}}>
        {children}
      </div>
    </div>
  );
}
