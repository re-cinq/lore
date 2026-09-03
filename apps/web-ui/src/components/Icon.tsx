"use client";

import { Icon as Iconify, addCollection } from "@iconify/react";
import lucideIcons from "@iconify-json/lucide/icons.json";
import pixelIcons from "@iconify-json/pixelarticons/icons.json";
import type { IconifyJSON } from "@iconify/types";
import { useTheme } from "@/lib/theme/ThemeProvider";
import styles from "./Icon.module.scss";
import { ICONS, type IconName } from "./icon-map";

// Registered once at module load so icons render inline with no network fetch (required under Next's `output: standalone`).
addCollection(lucideIcons as IconifyJSON);
addCollection(pixelIcons as IconifyJSON);

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Opt-in (not default) baseline offset for icons inside running text, so a caller's own alignment is never silently overridden. */
  inline?: boolean;
  "aria-label"?: string;
}

export default function Icon({
  name,
  size = 16,
  className,
  inline = false,
  ...rest
}: IconProps) {
  const { family } = useTheme();
  const aria = rest["aria-label"];

  return (
    <Iconify
      icon={ICONS[family][name]}
      width={size}
      height={size}
      className={[className, inline ? styles.inline : ""]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={aria ? undefined : true}
      aria-label={aria}
    />
  );
}
