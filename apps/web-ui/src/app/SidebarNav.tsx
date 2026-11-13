"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import NavLink from "@/components/NavLink";
import Icon from "@/components/Icon";
import { isNavActive } from "@/lib/nav-active";
import { SidebarHelp } from "@/components/shell/SidebarTools";
import {
  footerDestinations,
  navGroups,
  type NavDestination,
  type NavGroup,
} from "@/components/shell/nav-groups";
import styles from "./SidebarNav.module.css";

/** Each address is the deployment's to name; an absent one renders no link at all (lib/headlamp-url.ts). */
interface ExternalAppUrls {
  /** The cluster dashboard. */
  headlampUrl?: string;
  /** The metrics dashboards (ADR-050). */
  grafanaUrl?: string;
  /** Utopia, the application beside Lore. */
  utopiaUrl?: string;
}

interface SidebarNavProps extends ExternalAppUrls {
  /** Count of open inbox items, drawn as a badge on `/inbox` when positive. */
  inboxCount?: number;
}

export default function SidebarNav({
  inboxCount,
  ...externalApps
}: SidebarNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <>
      <NavGroups
        pathname={pathname}
        inboxCount={inboxCount}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <NavFooter pathname={pathname} externalApps={externalApps} />
    </>
  );
}

interface NavGroupsProps {
  pathname: string;
  inboxCount?: number;
  collapsed: Record<string, boolean>;
  onToggle: (label: string) => void;
}

/** Every group in nav order. */
function NavGroups(props: NavGroupsProps) {
  const { pathname, inboxCount, collapsed, onToggle } = props;

  return (
    <nav>
      {navGroups.map((group) => (
        <NavGroupSection
          key={group.label}
          group={group}
          pathname={pathname}
          inboxCount={inboxCount}
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

/** The links belonging to no section of the app, under the two help dialogs: settings is org-wide, adding a repo grows the list itself, and the cluster dashboard, Grafana and Utopia are different applications. */
function NavFooter({ pathname, externalApps }: NavFooterProps) {
  return (
    <div className={styles.footer}>
      <SidebarHelp />
      <ExternalApps {...externalApps} />
      <FooterActions pathname={pathname} />
    </div>
  );
}

const FOOTER_CLASS: Record<string, string> = {
  "/settings": styles.footerLink,
  "/onboard": styles.addRepo,
};

/** Settings and Add repo: the two in-app destinations that belong to no section. */
function FooterActions({ pathname }: { pathname: string }) {
  return (
    <>
      {footerDestinations.map((link) => (
        <TitledNavLink
          key={link.href}
          link={link}
          pathname={pathname}
          className={FOOTER_CLASS[link.href]}
        />
      ))}
    </>
  );
}

interface TitledNavLinkProps {
  link: NavDestination;
  pathname: string;
  badge?: number;
  className?: string;
}

/** A nav link titled with its label, so the icon rail still names it on hover. */
function TitledNavLink({
  link,
  pathname,
  badge,
  className,
}: TitledNavLinkProps) {
  return (
    <span title={link.label} className={styles.item}>
      <NavLink
        href={link.href}
        label={link.label}
        icon={link.icon}
        badge={badge}
        active={isNavActive(pathname, link.href, "/")}
        className={className}
      />
    </span>
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
      className={`${styles.footerLink} rail-hidden`}
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
  inboxCount?: number;
  collapsed: boolean;
  onToggle: (label: string) => void;
}

/** A group's toggle always shows; its links only while it is open. */
function NavGroupSection({
  group,
  pathname,
  inboxCount,
  collapsed,
  onToggle,
}: NavGroupSectionProps) {
  return (
    <CollapsibleGroup
      label={group.label}
      links={navLinks(group, pathname, inboxCount)}
      collapsed={collapsed}
      onToggle={onToggle}
    />
  );
}

/** The group's links, each knowing whether it is the current page. Active is computed here rather than per link so one pass over the pathname answers for the whole group. */
function navLinks(group: NavGroup, pathname: string, inboxCount?: number) {
  return group.links.map((link) => (
    <TitledNavLink
      key={link.href}
      link={link}
      pathname={pathname}
      badge={link.href === "/inbox" ? inboxCount : undefined}
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
      className={`${styles.groupLabel} rail-hidden`}
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
