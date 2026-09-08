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

/** Which palette the page uses. A real radio group rather than styled buttons: the browser then gives arrow-key navigation and the grouping announcement for free. */
function FamilyGroup({
  selected,
  onSelect,
}: {
  selected: ThemeFamily;
  onSelect: (next: ThemeFamily) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.segmented}>
        {FAMILIES.map(({ value, label }) => (
          <label
            key={value}
            className={`${styles.option}${selected === value ? ` ${styles.selected}` : ""}`}
          >
            <input
              type="radio"
              name="theme-family"
              value={value}
              checked={selected === value}
              onChange={() => onSelect(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One appearance choice. Icon-only, so the label rides as both `title` and `aria-label` — the icon alone names nothing to a screen reader. */
function SchemeOption({
  option,
  selected,
  onSelect,
}: {
  option: (typeof SCHEMES)[number];
  selected: boolean;
  onSelect: (next: ColorSchemePref) => void;
}) {
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

/** Light, dark, or follow the system. Icon-only, so each option carries its label as `title` and `aria-label` — the icon alone names nothing to a screen reader. */
function SchemeGroup({
  selected,
  onSelect,
}: {
  selected: ColorSchemePref;
  onSelect: (next: ColorSchemePref) => void;
}) {
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
