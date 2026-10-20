import { Inter, IBM_Plex_Mono, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// IBM Plex Mono — retro titles + code (clean, readable monospace).
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});

// GohuFont (bitmap, WTFPL) — retro regular/body text; self-hosted, native 14px grid.
export const gohu = localFont({
  src: "./fonts/gohufont-uni-14.ttf",
  display: "swap",
  variable: "--font-gohu",
});

// Lore family: Plex Sans stands in for the brand's licensed Neue Montreal, which a public repo cannot ship.
export const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ibm-plex-sans",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});
