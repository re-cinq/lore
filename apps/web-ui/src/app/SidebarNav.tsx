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
    // eslint-disable-next-line re-lint/no-duplicate-code -- the nav section table, restated in SidebarNav.test.tsx as the exact sections and order a reader must see; the restatement is the assertion, so there is nothing here to share with it
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
      // eslint-disable-next-line re-lint/no-duplicate-code -- the second nav section's links, likewise restated in SidebarNav.test.tsx as the expected list; a test that imported this table would assert only that the table equals itself
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

  return (
    <>
      <NavGroups pathname={pathname} collapsed={collapsed} onToggle={toggle} />
      <NavFooter pathname={pathname} />
    </>
  );
}

interface NavGroupsProps {
  pathname: string;
  collapsed: Record<string, boolean>;
  onToggle: (label: string) => void;
}

/** Every group in nav order. A group with no label has no collapsed state to look up, so it is asked for none. */
function NavGroups({ pathname, collapsed, onToggle }: NavGroupsProps) {
  return (
    <nav>
      {groups.map((group, i) => (
        <NavGroupSection
          key={group.label ?? `group-${i}`}
          group={group}
          pathname={pathname}
          collapsed={group.label ? (collapsed[group.label] ?? false) : false}
          onToggle={onToggle}
        />
      ))}
    </nav>
  );
}

/** The two links that sit below the groups rather than in one. Neither belongs to a section of the app — settings is org-wide, and adding a repo is how the list itself grows. */
function NavFooter({ pathname }: { pathname: string }) {
  return (
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
  );
}

interface NavGroupSectionProps {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onToggle: (label: string) => void;
}

/** A labelled group collapses; an unlabelled one is always open, which is how the top-level links render without a header. */
function NavGroupSection({
  group,
  pathname,
  collapsed,
  onToggle,
}: NavGroupSectionProps) {
  const links = navLinks(group, pathname);

  if (!group.label) {
    return <div className={styles.group}>{links}</div>;
  }

  return (
    <CollapsibleGroup
      label={group.label}
      links={links}
      collapsed={collapsed}
      onToggle={onToggle}
    />
  );
}

/** The group's links, each knowing whether it is the current page. Active is computed here rather than per link so one pass over the pathname answers for the whole group. */
function navLinks(group: NavGroup, pathname: string) {
  return group.links.map(({ href, label }) => (
    <NavLink
      key={href}
      href={href}
      label={label}
      active={isNavActive(pathname, href, "/")}
    />
  ));
}

interface CollapsibleGroupProps {
  label: string;
  links: React.ReactNode;
  collapsed: boolean;
  onToggle: (label: string) => void;
}

/** A labelled group: its toggle always shows, its links only while open. */
function CollapsibleGroup({
  label,
  links,
  collapsed,
  onToggle,
}: CollapsibleGroupProps) {
  return (
    <div className={styles.group}>
      <GroupHeader label={label} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && links}
    </div>
  );
}

interface GroupHeaderProps {
  label: string;
  collapsed: boolean;
  onToggle: (label: string) => void;
}

/** The group's own toggle. A button rather than a heading because it does something, and `aria-expanded` reports which way it is currently pointing. */
function GroupHeader({ label, collapsed, onToggle }: GroupHeaderProps) {
  return (
    <button
      type="button"
      className={styles.groupLabel}
      onClick={() => onToggle(label)}
      aria-expanded={!collapsed}
    >
      {label}
      <Icon
        name="chevron"
        size={12}
        className={collapsed ? styles.chevronCollapsed : styles.chevron}
      />
    </button>
  );
}
