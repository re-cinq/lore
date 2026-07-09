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

const groups: NavGroup[] = [
  { links: [{ href: "/", label: "Repos" }] },
  {
    label: "Pipeline",
    links: [
      { href: "/assembly-lines", label: "Assembly Lines" },
      { href: "/tasks", label: "Tasks" },
    ],
  },
  {
    label: "Knowledge",
    links: [
      { href: "/context", label: "Context" },
      { href: "/specs", label: "Specs" },
      { href: "/gaps", label: "Gaps" },
      { href: "/pools", label: "Pools" },
      { href: "/graph", label: "Graph" },
      { href: "/episodes", label: "Episodes" },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/analytics", label: "Analytics" },
      { href: "/spend", label: "Spend" },
      { href: "/search", label: "Search" },
      { href: "/audit", label: "Audit" },
    ],
  },
  {
    label: "Config",
    links: [
      { href: "/agents", label: "Agents" },
      { href: "/settings", label: "Settings" },
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
      <NavLink
        href="/onboard"
        label="+ Add Repo"
        active={isNavActive(pathname, "/onboard", "/")}
        className={styles.addRepo}
      />
    </>
  );
}
