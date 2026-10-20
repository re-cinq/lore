"use client";

import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icon-map";
import { useShell } from "./ShellProvider";
import styles from "./SidebarTools.module.css";

/** The sidebar's "Search or jump to" pill: the palette's mouse door, labelled with its ⌘K key door. */
export function SidebarSearch() {
  const { show } = useShell();

  return (
    <div className={styles.searchRow}>
      <button
        type="button"
        className={styles.search}
        onClick={() => show("palette")}
        title="Search or jump to (⌘K)"
      >
        <Icon name="search" size={16} />
        <span className={`${styles.searchText} rail-hidden`}>
          Search or jump to…
        </span>
        <kbd className={`${styles.kbd} rail-hidden`}>⌘K</kbd>
      </button>
    </div>
  );
}

const HELP_BUTTONS: {
  overlay: "glossary" | "shortcuts";
  label: string;
  icon: IconName;
  title?: string;
}[] = [
  { overlay: "glossary", label: "Glossary", icon: "glossary" },
  {
    overlay: "shortcuts",
    label: "Shortcuts",
    icon: "keyboard",
    title: "Keyboard shortcuts (?)",
  },
];

/** Glossary and Shortcuts, the two help dialogs, at the top of the sidebar footer. */
export function SidebarHelp() {
  const { show } = useShell();

  return (
    <div className={`${styles.help} rail-hidden`}>
      {HELP_BUTTONS.map(({ overlay, label, icon, title }) => (
        <button
          key={overlay}
          type="button"
          className={styles.helpButton}
          onClick={() => show(overlay)}
          title={title}
        >
          <Icon name={icon} size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Folds the sidebar to an icon rail and back; the choice is remembered per browser. */
export function RailToggle() {
  const { rail, toggleRail } = useShell();
  const label = rail ? "Expand sidebar" : "Collapse sidebar";

  return (
    <button
      type="button"
      className={styles.railToggle}
      onClick={toggleRail}
      aria-label={label}
      aria-pressed={rail}
      title={label}
    >
      <Icon name={rail ? "sidebarExpand" : "sidebarCollapse"} size={18} />
    </button>
  );
}

/** The mobile header's search pill, opening the same palette. */
export function MobileSearchButton() {
  const { show } = useShell();

  return (
    <button
      type="button"
      className={styles.mobileSearch}
      onClick={() => show("palette")}
      aria-label="Search"
    >
      <Icon name="search" size={16} />
    </button>
  );
}
