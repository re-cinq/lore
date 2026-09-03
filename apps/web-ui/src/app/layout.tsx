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
    // THEME_SCRIPT hydrates before React; suppressHydrationWarning suppresses expected mismatch.
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
