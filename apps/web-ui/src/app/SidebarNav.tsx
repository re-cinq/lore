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

// Repo-centric nav (spec 4-ux-repo-onboarding FR-3.8) — only genuinely cross-repo views live at top level.
const groups: NavGroup[] = [
  {
    links: [
      { href: "/", label: "Repos" },
      { href: "/assembly-runs", label: "Assembly Runs" },
      { href: "/agents", label: "Agents" },
      { href: "/cluster-agents", label: "Clusters" },
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

/** A labelled group collapses; an unlabelled one is always open, which is how the top-level links render without a header. */
function NavGroupSection({
  group,
  pathname,
  collapsed,
  onToggle,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onToggle: (label: string) => void;
}) {
  const links = group.links.map(({ href, label }) => (
    <NavLink
      key={href}
      href={href}
      label={label}
      active={isNavActive(pathname, href, "/")}
    />
  ));

  if (!group.label) {
    return <div className={styles.group}>{links}</div>;
  }

  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.groupLabel}
        onClick={() => onToggle(group.label!)}
        aria-expanded={!collapsed}
      >
        {group.label}
        <Icon
          name="chevron"
          size={12}
          className={collapsed ? styles.chevronCollapsed : styles.chevron}
        />
      </button>
      {!collapsed && links}
    </div>
  );
}

export default function SidebarNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <>
      <nav>
        {groups.map((group, i) => (
          <NavGroupSection
            key={group.label ?? `group-${i}`}
            group={group}
            pathname={pathname}
            collapsed={group.label ? (collapsed[group.label] ?? false) : false}
            onToggle={toggle}
          />
        ))}
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
