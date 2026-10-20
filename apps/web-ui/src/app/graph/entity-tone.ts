import type { StatusTone } from "@/components/StatusPill";

// The design's tones per entity type; a type it does not name reads as idle.
const TYPE_TONE: Record<string, StatusTone> = {
  service: "running",
  concept: "waiting",
  decision: "warn",
  person: "ok",
};

/** The tone an entity type's chip and pill are tinted with. */
export function entityTone(entityType: string): StatusTone {
  return TYPE_TONE[entityType] ?? "idle";
}

interface GraphQuery {
  entity?: string;
  type?: string;
  showInvalid?: boolean;
}

/** A /graph link for one view of it; empty parts stay out of the URL. */
export function graphHref({ entity, type, showInvalid }: GraphQuery): string {
  const parts = [
    entity ? `entity=${encodeURIComponent(entity)}` : "",
    type ? `type=${encodeURIComponent(type)}` : "",
    showInvalid ? "show_invalid=1" : "",
  ].filter(Boolean);

  return parts.length ? `/graph?${parts.join("&")}` : "/graph";
}
