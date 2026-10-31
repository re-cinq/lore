import localFont from "next/font/local";

// Checked-in files (OFL 1.1, fontsource latin subset): next/font/google fetched at build time and a failed fetch broke the build (#4047).

export const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

// IBM Plex Mono — retro titles + code (clean, readable monospace).
export const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-latin-600.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-mono-latin-700.woff2", weight: "700" },
  ],
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
export const ibmPlexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-300.woff2", weight: "300" },
    { path: "./fonts/ibm-plex-sans-latin-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-latin-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-latin-600.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-latin-700.woff2", weight: "700" },
  ],
  display: "swap",
  variable: "--font-ibm-plex-sans",
});

export const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
});
