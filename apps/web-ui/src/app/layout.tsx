import type { Metadata, Viewport } from "next";
import Link from "next/link";
import AppShell from "./AppShell";
import BrandLockup from "@/components/BrandLockup";
import SidebarNav from "./SidebarNav";
import UserMenu from "./UserMenu";
import { RailToggle, SidebarSearch } from "@/components/shell/SidebarTools";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { liveSocketUrl } from "@/lib/live-socket-url";
import { grafanaUrl, headlampUrl, utopiaUrl } from "@/lib/headlamp-url";
import {
  inter,
  ibmPlexMono,
  ibmPlexSans,
  jetbrainsMono,
  gohu,
} from "@/lib/theme/fonts";
import { THEME_SCRIPT } from "@/lib/theme/theme-script";
import { getSession } from "@/lib/session";
import "./theme.css";
import "highlight.js/styles/github.css";
import "./globals.css";
import "./chicago.css";
import "./lore.css";
import "@re-cinq/planning-editor/style.css";

export const metadata: Metadata = {
  title: "Lore",
  description: "Research coordination platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

type SidebarUser = Parameters<typeof UserMenu>[0]["user"];

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const session = await getSession();

  return (
    // THEME_SCRIPT hydrates before React; suppressHydrationWarning suppresses expected mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable} ${gohu.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ThemeProvider>
          <LiveSocketProvider url={liveSocketUrl(process.env)}>
            <AppShell sidebar={<Sidebar user={session?.user ?? null} />}>
              {children}
            </AppShell>
          </LiveSocketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

/** Brand and the rail toggle, the palette's search pill, the nav, and at the foot the signed-in user beside the deployed build (what someone reads when working out whether what they see is what was merged). */
function Sidebar({ user }: { user: SidebarUser }) {
  return (
    <>
      <div className="sidebar-head">
        <Link href="/" className="sidebar-brand" aria-label="Lore home">
          <BrandLockup />
        </Link>
        <RailToggle />
      </div>
      <SidebarSearch />
      <SidebarNav
        headlampUrl={headlampUrl(process.env)}
        grafanaUrl={grafanaUrl(process.env)}
        utopiaUrl={utopiaUrl(process.env)}
      />
      <UserMenu user={user} version={process.env.LORE_UI_VERSION ?? "dev"} />
    </>
  );
}
