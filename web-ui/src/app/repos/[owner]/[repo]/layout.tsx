import Link from 'next/link';

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const base = `/repos/${owner}/${repo}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/tasks`, label: 'Tasks' },
    { href: `${base}/context`, label: 'Context' },
    { href: `${base}/specs`, label: 'Specs' },
    { href: `${base}/agents`, label: 'Agents' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  return (
    <div>
      <h1 style={{marginBottom:'4px'}}>{owner}/{repo}</h1>
      <nav className="tab-nav">
        {tabs.map(t => (
          <Link key={t.href} href={t.href} className="tab-link">{t.label}</Link>
        ))}
      </nav>
      <div style={{marginTop:'16px'}}>
        {children}
      </div>
    </div>
  );
}
