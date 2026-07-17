"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import NavLink from "@/components/NavLink";
import Icon from "@/components/Icon";
import { isNavActive } from "@/lib/nav-active";
import styles from "./SidebarNav.module.css";

interface NavGroup {
  label?: string;
  links: { href: string; label: string }[];
}

// Repo-centric nav (spec 4-ux-repo-onboarding, FR-3.8): everything about a repo
// lives in its own tabs under /repos/[owner]/[repo]; only genuinely cross-repo
// views stay at the top level. Repos (home), plus global Search / Audit / Pools,
// plus the cross-repo Insights.
const groups: NavGroup[] = [
  {
    links: [
      { href: "/", label: "Repos" },
      { href: "/search", label: "Search" },
      { href: "/audit", label: "Audit" },
      { href: "/pools", label: "Pools" },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/analytics", label: "Analytics" },
      { href: "/spend", label: "Spend" },
      { href: "/gaps", label: "Gaps" },
      { href: "/episodes", label: "Episodes" },
      { href: "/graph", label: "Graph" },
      { href: "/specs", label: "Specs" },
      { href: "/adrs", label: "ADRs" },
    ],
  },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  const renderLinks = (links: NavGroup["links"]) =>
    links.map(({ href, label }) => (
      <NavLink
        key={href}
        href={href}
        label={label}
        active={isNavActive(pathname, href, "/")}
      />
    ));

  return (
    <>
      <nav>
        {groups.map((group, i) => {
          if (!group.label) {
            return (
              <div key={`group-${i}`} className={styles.group}>
                {renderLinks(group.links)}
              </div>
            );
          }
          const isCollapsed = collapsed[group.label] ?? false;

          return (
            <div key={group.label} className={styles.group}>
              <button
                type="button"
                className={styles.groupLabel}
                onClick={() => toggle(group.label!)}
                aria-expanded={!isCollapsed}
              >
                {group.label}
                <Icon
                  name="chevron"
                  size={12}
                  className={
                    isCollapsed ? styles.chevronCollapsed : styles.chevron
                  }
                />
              </button>
              {!isCollapsed && renderLinks(group.links)}
            </div>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <NavLink
          href="/settings"
          label="Settings"
          active={isNavActive(pathname, "/settings", "/")}
          className={styles.footerLink}
        />
        <NavLink
          href="/onboard"
          label="+ Add Repo"
          active={isNavActive(pathname, "/onboard", "/")}
          className={styles.addRepo}
        />
      </div>
    </>
  );
}
