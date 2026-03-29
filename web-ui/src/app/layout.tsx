import type { Metadata } from 'next';
import SidebarNav from './SidebarNav';
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
            <SidebarNav />
          </aside>
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
