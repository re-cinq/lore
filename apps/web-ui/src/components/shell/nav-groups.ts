import type { IconName } from "@/lib/icon-map";

/** One in-app destination: the sidebar draws it as a link, the command palette as an entry. */
export interface NavDestination {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  label: string;
  links: NavDestination[];
}

// Lore v2's three sections (spec 4-ux-repo-onboarding FR-3.8: only genuinely cross-repo views live at top level).
export const navGroups: NavGroup[] = [
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

/** The two destinations that belong to no section: settings is org-wide, adding a repo grows the list itself. */
export const footerDestinations: NavDestination[] = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/onboard", label: "Add repo", icon: "add" },
];
