"use client";

import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ColorSchemePref, ThemeFamily } from "@/lib/theme/types";
import Icon from "./Icon";
import type { IconName } from "@/lib/icon-map";
import styles from "./ThemeSwitcher.module.css";

const FAMILIES: { value: ThemeFamily; label: string }[] = [
  { value: "elegant", label: "Elegant" },
  { value: "retro", label: "Retro" },
  { value: "chicago", label: "Classic" },
];

const SCHEMES: { value: ColorSchemePref; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "auto", label: "Auto", icon: "monitor" },
  { value: "dark", label: "Dark", icon: "moon" },
];

interface FamilyOptionProps {
  value: ThemeFamily;
  label: string;
  selected: boolean;
  onSelect: (next: ThemeFamily) => void;
}

/** One palette choice, labelled in words — a family name means nothing as an icon. */
function FamilyOption({ value, label, selected, onSelect }: FamilyOptionProps) {
  return (
    <label
      className={`${styles.option}${selected ? ` ${styles.selected}` : ""}`}
    >
      <input
        type="radio"
        name="theme-family"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
      />
      {label}
    </label>
  );
}

interface FamilyGroupProps {
  selected: ThemeFamily;
  onSelect: (next: ThemeFamily) => void;
}

/** Which palette the page uses. A real radio group rather than styled buttons: the browser then gives arrow-key navigation and the grouping announcement for free. */
function FamilyGroup({ selected, onSelect }: FamilyGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.segmented}>
        {FAMILIES.map(({ value, label }) => (
          <FamilyOption
            key={value}
            value={value}
            label={label}
            selected={selected === value}
            onSelect={onSelect}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface SchemeOptionProps {
  option: (typeof SCHEMES)[number];
  selected: boolean;
  onSelect: (next: ColorSchemePref) => void;
}

/** One appearance choice. Icon-only, so the label rides as both `title` and `aria-label` — the icon alone names nothing to a screen reader. */
function SchemeOption({ option, selected, onSelect }: SchemeOptionProps) {
  return (
    <label
      className={`${styles.option} ${styles.iconOnly}${selected ? ` ${styles.selected}` : ""}`}
      title={option.label}
    >
      <input
        type="radio"
        name="color-scheme"
        value={option.value}
        checked={selected}
        onChange={() => onSelect(option.value)}
        aria-label={option.label}
      />
      <Icon name={option.icon} size={16} />
    </label>
  );
}

interface SchemeGroupProps {
  selected: ColorSchemePref;
  onSelect: (next: ColorSchemePref) => void;
}

/** Light, dark, or follow the system. Icon-only, so each option carries its label as `title` and `aria-label` — the icon alone names nothing to a screen reader. */
function SchemeGroup({ selected, onSelect }: SchemeGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Appearance</legend>
      <div className={styles.segmented}>
        {SCHEMES.map((option) => (
          <SchemeOption
            key={option.value}
            option={option}
            selected={selected === option.value}
            onSelect={onSelect}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default function ThemeSwitcher() {
  const { family, scheme, setFamily, setScheme } = useTheme();

  return (
    <div className={styles.switcher}>
      <FamilyGroup selected={family} onSelect={setFamily} />
      <SchemeGroup selected={scheme} onSelect={setScheme} />
    </div>
  );
}
