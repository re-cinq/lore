import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lore',
  description: 'Research coordination platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          <aside className="sidebar">
            <div className="sidebar-brand">LORE</div>
            <nav>
              <Link href="/">Agents</Link>
              <Link href="/search">Search</Link>
              <Link href="/audit">Audit</Link>
              <Link href="/pools">Pools</Link>
              <Link href="/tasks">Tasks</Link>
              <Link href="/specs">Specs</Link>
              <Link href="/gaps">Gaps</Link>
            </nav>
          </aside>
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
