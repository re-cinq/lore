import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import styles from "./DocsScreenHeader.module.scss";

export type DocsTab = "specs" | "adrs";

const TABS: { id: DocsTab; label: string; href: string }[] = [
  { id: "specs", label: "Specs", href: "/specs" },
  { id: "adrs", label: "ADRs", href: "/adrs" },
];

interface DocsScreenHeaderProps {
  active: DocsTab;
  /** What the open tab lists, said under the title. */
  summary: string;
}

/** The one title block `/specs` and `/adrs` share, so the two routes read as the tabs of one screen. */
export default function DocsScreenHeader(props: DocsScreenHeaderProps) {
  return (
    <ScreenHeader group="knowledge" title="Specs & ADRs" lede={props.summary}>
      <nav aria-label="Specs and ADRs" className={styles.tabs}>
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={styles.tab}
            aria-current={tab.id === props.active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </ScreenHeader>
  );
}
