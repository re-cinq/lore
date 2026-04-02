import type { Metadata } from 'next';
import SidebarWrapper from './SidebarWrapper';
import SessionWrapper from './SessionWrapper';
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
            <SidebarWrapper />
            <main className="main-content">{children}</main>
          </div>
        </SessionWrapper>
      </body>
    </html>
  );
}
