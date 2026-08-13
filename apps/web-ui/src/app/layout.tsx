import type { Metadata, Viewport } from "next";
import Link from "next/link";
import AppShell from "./AppShell";
import SidebarNav from "./SidebarNav";
import SessionWrapper from "./SessionWrapper";
import UserMenu from "./UserMenu";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { inter, ibmPlexMono, gohu } from "@/lib/theme/fonts";
import { THEME_SCRIPT } from "@/lib/theme/theme-script";
import "./theme.css";
import "highlight.js/styles/github.css";
import "./globals.css";
import "./chicago.css";

export const metadata: Metadata = {
  title: "Lore",
  description: "Research coordination platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // THEME_SCRIPT stamps data-theme-family / data-color-scheme onto <html> before
    // React hydrates — that is the whole point of it, and why there is no flash of
    // the wrong theme. So the server HTML and the client DOM differ on this element
    // by design, and React's hydration diff says so on every page load. Suppressing
    // it covers THIS element's own attributes only, not the tree, so a real mismatch
    // anywhere inside still reports. Without it the warning is permanent noise, and
    // permanent noise is what a genuine mismatch hides behind.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${ibmPlexMono.variable} ${gohu.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ThemeProvider>
          <SessionWrapper>
            <AppShell
              sidebar={
                <>
                  <Link href="/" className="sidebar-brand">
                    <img src="/logo.svg" alt="Lore" width={80} height={80} />
                  </Link>
                  <SidebarNav />
                  <UserMenu />
                  <div
                    className="meta sidebar-version"
                    title="Deployed build (git SHA)"
                  >
                    {process.env.LORE_UI_VERSION ?? "dev"}
                  </div>
                </>
              }
            >
              {children}
            </AppShell>
          </SessionWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
