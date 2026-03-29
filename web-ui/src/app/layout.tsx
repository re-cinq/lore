import type { Metadata } from 'next';
import SidebarNav from './SidebarNav';
import SessionWrapper from './SessionWrapper';
import UserMenu from './UserMenu';
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
        <SessionWrapper>
          <div className="app-layout">
            <aside className="sidebar">
              <div className="sidebar-brand">
                <img src="/logo.svg" alt="Lore" width={28} height={28} />
                LORE
              </div>
              <SidebarNav />
              <UserMenu />
            </aside>
            <main className="main-content">{children}</main>
          </div>
        </SessionWrapper>
      </body>
    </html>
  );
}
