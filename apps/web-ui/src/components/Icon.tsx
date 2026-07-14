"use client";

import { Icon as Iconify, addCollection } from "@iconify/react";
import lucideIcons from "@iconify-json/lucide/icons.json";
import pixelIcons from "@iconify-json/pixelarticons/icons.json";
import type { IconifyJSON } from "@iconify/types";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { ICONS, type IconName } from "./icon-map";

// Register both collections once, at module load, so icons render inline with
// no network fetch (required under Next's `output: standalone`).
addCollection(lucideIcons as IconifyJSON);
addCollection(pixelIcons as IconifyJSON);

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /**
   * Opt-in for icons sitting inside running text (not a flex container): an
   * inline SVG sits on the text baseline and reads as "floating" next to the
   * text, so -0.125em optically centers it. Opt-in rather than a default so a
   * caller's own alignment (className or flex) is never silently overridden.
   */
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
      className={className}
      style={inline ? { verticalAlign: "-0.125em" } : undefined}
      aria-hidden={aria ? undefined : true}
      aria-label={aria}
    />
  );
}
