import type { Metadata, Viewport } from 'next';
import SessionWrapper from './SessionWrapper';
import AppShell from './AppShell';
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
          <AppShell>{children}</AppShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
