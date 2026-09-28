import type { NotifyChannel } from "../../../domain/dark-factory-settings.js";
import type { NotifyLevel, NotifyResult } from "./notify-port.js";

/** Channel-filtering decision (relocated from agent/src/lib/notify.ts). */
export interface NotifySettings {
  channels: NotifyChannel[];
}

export function decideNotify(
  level: NotifyLevel,
  settings: NotifySettings,
): NotifyResult {
  const { channels } = settings;

  if (channels.includes("all")) {
    return { fire: true, matchedChannels: ["all"] };
  }

  if (level === "escalation") {
    return { fire: true, matchedChannels: ["escalation"] };
  }

  if (isWatchedLevel(level) && channels.includes("watched")) {
    return { fire: true, matchedChannels: ["watched"] };
  }

  if (level === "pr_open" && channels.includes("pr_open")) {
    return { fire: true, matchedChannels: ["pr_open"] };
  }

  // A level whose own channel is not listed: only `all` lets it through
  return { fire: false, matchedChannels: [] };
}

function isWatchedLevel(level: NotifyLevel): boolean {
  return level === "watched" || level === "completion";
}
