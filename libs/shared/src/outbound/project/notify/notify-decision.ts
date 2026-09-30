import type { NotifyChannel } from "../../../domain/dark-factory-settings.js";
import type { NotifyLevel, NotifyResult } from "./notify-port.js";

/** Channel-filtering decision (relocated from agent/src/lib/notify.ts). */
export interface NotifySettings {
  channels: NotifyChannel[];
}

/** The channel that lets each level through on its own; `all` lets every level through. */
const LEVEL_CHANNEL: Record<NotifyLevel, NotifyChannel> = {
  escalation: "escalation",
  watched: "watched",
  completion: "watched",
  pr_open: "pr_open",
};

export function decideNotify(
  level: NotifyLevel,
  settings: NotifySettings,
): NotifyResult {
  const { channels } = settings;

  if (channels.includes("all")) {
    return { fire: true, matchedChannels: ["all"] };
  }

  const channel = LEVEL_CHANNEL[level];

  // Escalation is the platform's floor: it fires with or without its channel listed.
  if (level === "escalation" || channels.includes(channel)) {
    return { fire: true, matchedChannels: [channel] };
  }

  return { fire: false, matchedChannels: [] };
}
