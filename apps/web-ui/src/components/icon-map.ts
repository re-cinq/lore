import type { ThemeFamily } from "@/lib/theme/types";

export type IconName =
  | "check"
  | "warning"
  | "error"
  | "unknown"
  | "pending"
  | "external"
  | "lock"
  | "close"
  | "add"
  | "search"
  | "settings"
  | "menu"
  | "sun"
  | "moon"
  | "monitor"
  | "bullet"
  | "draft"
  | "implement"
  | "validate"
  | "push"
  | "review"
  | "address"
  | "retrospective"
  | "done"
  | "gate";

export const ICONS: Record<ThemeFamily, Record<IconName, string>> = {
  elegant: {
    check: "lucide:check",
    warning: "lucide:triangle-alert",
    error: "lucide:x",
    unknown: "lucide:minus",
    pending: "lucide:clock",
    external: "lucide:arrow-up-right",
    lock: "lucide:lock",
    close: "lucide:x",
    add: "lucide:plus",
    search: "lucide:search",
    settings: "lucide:settings",
    menu: "lucide:menu",
    sun: "lucide:sun",
    moon: "lucide:moon",
    monitor: "lucide:monitor",
    bullet: "lucide:dot",
    draft: "lucide:pencil",
    implement: "lucide:wrench",
    validate: "lucide:circle-check",
    push: "lucide:arrow-up",
    review: "lucide:search",
    address: "lucide:hammer",
    retrospective: "lucide:notebook-pen",
    done: "lucide:flag",
    gate: "lucide:construction",
  },
  retro: {
    check: "pixelarticons:check",
    warning: "pixelarticons:alert",
    error: "pixelarticons:close",
    unknown: "pixelarticons:minus",
    pending: "pixelarticons:clock",
    external: "pixelarticons:external-link",
    lock: "pixelarticons:lock",
    close: "pixelarticons:close",
    add: "pixelarticons:plus",
    search: "pixelarticons:search",
    settings: "pixelarticons:sliders",
    menu: "pixelarticons:menu",
    sun: "pixelarticons:sun",
    moon: "pixelarticons:moon",
    monitor: "pixelarticons:device-laptop",
    bullet: "pixelarticons:circle",
    draft: "pixelarticons:edit",
    implement: "pixelarticons:android",
    validate: "pixelarticons:check-double",
    push: "pixelarticons:arrow-up",
    review: "pixelarticons:search",
    address: "pixelarticons:briefcase",
    retrospective: "pixelarticons:notes",
    done: "pixelarticons:flag",
    gate: "pixelarticons:debug",
  },
};
