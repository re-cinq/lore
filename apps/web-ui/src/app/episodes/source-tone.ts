import type { StatusTone } from "@/components/StatusPill";

// Design tones per episode type; Lore's current sources map onto the type they carry.
const SOURCE_TONE: Record<string, StatusTone> = {
  review: "running",
  "pr-review": "running",
  conversation: "waiting",
  session: "waiting",
  pr_outcome: "ok",
  observation: "warn",
  manual: "warn",
};

/** The tone an episode source's chip and pill are tinted with. */
export function sourceTone(source: string): StatusTone {
  return SOURCE_TONE[source] ?? "idle";
}
