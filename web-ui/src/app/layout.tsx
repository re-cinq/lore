import type { Metadata } from 'next';
import SessionWrapper from './SessionWrapper';
import AppLayout from './AppLayout';
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
          <AppLayout>{children}</AppLayout>
        </SessionWrapper>
      </body>
    </html>
  );
}
