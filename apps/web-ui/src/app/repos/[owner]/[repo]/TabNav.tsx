"use client";

import { usePathname } from "next/navigation";
import NavLink from "@/components/NavLink";
import { isNavActive } from "@/lib/nav-active";

export interface Tab {
  href: string;
  label: string;
}

export default function TabNav({ tabs, base }: { tabs: Tab[]; base: string }) {
  const pathname = usePathname();

  return (
    <nav className="tab-nav">
      {tabs.map((tab) => (
        <NavLink
          key={tab.href}
          href={tab.href}
          label={tab.label}
          active={isNavActive(pathname, tab.href, base)}
          className="tab-link"
        />
      ))}
    </nav>
  );
}
