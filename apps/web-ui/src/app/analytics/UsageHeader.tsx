import Link from "next/link";
import type { ReactNode } from "react";
import { InsightsHeading } from "@/components/insights/InsightsHeading";
import styles from "./UsageHeader.module.css";

export type UsageTab = "activity" | "spend";

const TABS: Array<{ key: UsageTab; label: string; href: string }> = [
  { key: "activity", label: "Activity", href: "/analytics" },
  { key: "spend", label: "Spend", href: "/spend" },
];

interface UsageHeaderProps {
  active: UsageTab;
  lede?: ReactNode;
}

/** The one header /analytics and /spend share: the title, then a tab per route. Each tab is a link, so the two stay separate pages. */
export function UsageHeader({ active, lede }: UsageHeaderProps) {
  return (
    <>
      <InsightsHeading title="Usage & spend" lede={lede} />
      <nav className={styles.tabs} aria-label="Usage views">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={styles.tab}
            aria-current={tab.key === active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
