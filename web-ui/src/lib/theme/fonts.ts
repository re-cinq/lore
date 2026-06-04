import { Inter, IBM_Plex_Mono } from 'next/font/google';
import localFont from 'next/font/local';

export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

// IBM Plex Mono — retro titles + code (clean, readable monospace).
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
});

// GohuFont (bitmap, WTFPL) — retro regular/body text; self-hosted, native 14px grid.
export const gohu = localFont({
  src: './fonts/gohufont-uni-14.ttf',
  display: 'swap',
  variable: '--font-gohu',
});
