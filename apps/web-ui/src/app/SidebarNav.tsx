"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import NavLink from "@/components/NavLink";
import Icon from "@/components/Icon";
import { isNavActive } from "@/lib/nav-active";
import type { IconName } from "@/lib/icon-map";
import styles from "./SidebarNav.module.css";

interface NavGroup {
  label: string;
  links: { href: string; label: string; icon: IconName }[];
}

// Lore v2's three sections (spec 4-ux-repo-onboarding FR-3.8: only genuinely cross-repo views live at top level).
const groups: NavGroup[] = [
  {
    label: "Work",
    links: [
      { href: "/", label: "Repos", icon: "navRepos" },
      { href: "/assembly-runs", label: "Assembly runs", icon: "navRuns" },
      { href: "/agents", label: "Agents", icon: "navAgents" },
    ],
  },
  {
    label: "Knowledge",
    links: [
      { href: "/search", label: "Search", icon: "search" },
      { href: "/specs", label: "Specs", icon: "navSpecs" },
      { href: "/adrs", label: "ADRs", icon: "navAdrs" },
      { href: "/graph", label: "Graph", icon: "navGraph" },
      { href: "/episodes", label: "Episodes", icon: "navEpisodes" },
      { href: "/pools", label: "Pools", icon: "navPools" },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/analytics", label: "Analytics", icon: "navAnalytics" },
      { href: "/spend", label: "Spend", icon: "navSpend" },
      { href: "/gaps", label: "Gaps", icon: "navGaps" },
      { href: "/audit", label: "Audit", icon: "navAudit" },
    ],
  },
];

/** Each address is the deployment's to name; an absent one renders no link at all (lib/headlamp-url.ts). */
interface ExternalAppUrls {
  /** The cluster dashboard. */
  headlampUrl?: string;
  /** The metrics dashboards (ADR-050). */
  grafanaUrl?: string;
  /** Utopia, the application beside Lore. */
  utopiaUrl?: string;
}

export default function SidebarNav(externalApps: ExternalAppUrls) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <>
      <NavGroups pathname={pathname} collapsed={collapsed} onToggle={toggle} />
      <NavFooter pathname={pathname} externalApps={externalApps} />
    </>
  );
}

interface NavGroupsProps {
  pathname: string;
  collapsed: Record<string, boolean>;
  onToggle: (label: string) => void;
}

/** Every group in nav order. */
function NavGroups({ pathname, collapsed, onToggle }: NavGroupsProps) {
  return (
    <nav>
      {groups.map((group) => (
        <NavGroupSection
          key={group.label}
          group={group}
          pathname={pathname}
          collapsed={collapsed[group.label] ?? false}
          onToggle={onToggle}
        />
      ))}
    </nav>
  );
}

interface NavFooterProps {
  pathname: string;
  externalApps: ExternalAppUrls;
}

/** The links belonging to no section of the app: settings is org-wide, adding a repo grows the list itself, and the cluster dashboard, Grafana and Utopia are different applications. */
function NavFooter({ pathname, externalApps }: NavFooterProps) {
  return (
    <div className={styles.footer}>
      <ExternalApps {...externalApps} />
      <FooterActions pathname={pathname} />
    </div>
  );
}

/** Settings and Add repo: the two in-app destinations that belong to no section. */
function FooterActions({ pathname }: { pathname: string }) {
  return (
    <>
      <NavLink
        href="/settings"
        label="Settings"
        icon="settings"
        active={isNavActive(pathname, "/settings", "/")}
        className={styles.footerLink}
      />
      <NavLink
        href="/onboard"
        label="Add repo"
        icon="add"
        active={isNavActive(pathname, "/onboard", "/")}
        className={styles.addRepo}
      />
    </>
  );
}

const externalAppLinks: {
  urlKey: keyof ExternalAppUrls;
  label: string;
  title: string;
}[] = [
  {
    urlKey: "headlampUrl",
    label: "Headlamp",
    title: "Cluster dashboard (opens in a new tab)",
  },
  {
    urlKey: "grafanaUrl",
    label: "Grafana",
    title: "Metrics dashboards (opens in a new tab)",
  },
  {
    urlKey: "utopiaUrl",
    label: "Utopia",
    title: "Chat with models (opens in a new tab)",
  },
];

function ExternalApps(urls: ExternalAppUrls) {
  return (
    <>
      {externalAppLinks
        .filter(({ urlKey }) => urls[urlKey])
        .map(({ urlKey, label, title }) => (
          <ExternalAppLink
            key={label}
            href={urls[urlKey]!}
            label={label}
            title={title}
          />
        ))}
    </>
  );
}

interface ExternalAppLinkProps {
  href: string;
  label: string;
  title: string;
}

/** A plain anchor, not a NavLink: a separate application has no route to be active on and nothing for Next to prefetch. */
function ExternalAppLink({ href, label, title }: ExternalAppLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={styles.footerLink}
      title={title}
    >
      {label}
      <Icon name="external" size={12} />
    </a>
  );
}

interface NavGroupSectionProps {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onToggle: (label: string) => void;
}

/** A group's toggle always shows; its links only while it is open. */
function NavGroupSection({
  group,
  pathname,
  collapsed,
  onToggle,
}: NavGroupSectionProps) {
  return (
    <CollapsibleGroup
      label={group.label}
      links={navLinks(group, pathname)}
      collapsed={collapsed}
      onToggle={onToggle}
    />
  );
}

/** The group's links, each knowing whether it is the current page. Active is computed here rather than per link so one pass over the pathname answers for the whole group. */
function navLinks(group: NavGroup, pathname: string) {
  return group.links.map(({ href, label, icon }) => (
    <NavLink
      key={href}
      href={href}
      label={label}
      icon={icon}
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
      <span className={styles.groupName}>{label}</span>
      <Icon
        name="chevron"
        size={12}
        className={collapsed ? styles.chevronCollapsed : styles.chevron}
      />
    </button>
  );
}
