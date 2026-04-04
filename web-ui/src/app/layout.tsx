import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import AppShell from './AppShell';
import SidebarNav from './SidebarNav';
import SessionWrapper from './SessionWrapper';
import UserMenu from './UserMenu';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lore',
  description: 'Research coordination platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionWrapper>
          <AppShell
            sidebar={
              <>
                <Link href="/" className="sidebar-brand">
                  <img src="/logo.svg" alt="Lore" width={28} height={28} />
                  LORE
                </Link>
                <SidebarNav />
                <UserMenu />
              </>
            }
          >
            {children}
          </AppShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
