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
  "aria-label"?: string;
}

export default function Icon({
  name,
  size = 16,
  className,
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
      // Inline SVG sits on the text baseline and reads as "floating" next to
      // text; -0.125em optically centers it. Flex containers ignore it.
      style={{ verticalAlign: "-0.125em" }}
      aria-hidden={aria ? undefined : true}
      aria-label={aria}
    />
  );
}
