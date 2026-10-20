"use client";

import { usePathname } from "next/navigation";
import NavLink from "@/components/NavLink";
import { isNavActive } from "@/lib/nav-active";
import styles from "./TabNav.module.css";

export interface Tab {
  href: string;
  label: string;
}

export default function TabNav({ tabs, base }: { tabs: Tab[]; base: string }) {
  const pathname = usePathname();

  return (
    <nav className={`tab-nav ${styles.nav}`} aria-label="Repository">
      {tabs.map((tab) => (
        <NavLink
          key={tab.href}
          href={tab.href}
          label={tab.label}
          active={isNavActive(pathname, tab.href, base)}
          className={`tab-link ${styles.link}`}
        />
      ))}
    </nav>
  );
}
