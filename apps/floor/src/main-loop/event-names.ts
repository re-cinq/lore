/**
 * Event-name grammar for the Floor event bus: `source.subject.action`, where the
 * source prefix is globally unique so a name on one source can never collide with
 * another (e.g. `github.pull_request.closed` vs `kubernetes.agent.succeeded`).
 * Pure — no IO; the registry keys on the full name, producers build names from here.
 */

export const SOURCES = ["github", "kubernetes", "cron", "internal"] as const;
export type EventSource = (typeof SOURCES)[number];

export interface ParsedEventName {
  source: EventSource;
  subject: string;
  action: string;
}

function isSource(value: string): value is EventSource {
  return (SOURCES as readonly string[]).includes(value);
}

export function parseEventName(name: string): ParsedEventName {
  const parts = name.split(".");
  if (parts.length < 3 || parts.some((p) => p.length === 0)) {
    throw new Error(`invalid event name (need source.subject.action): ${name}`);
  }
  const [source, ...rest] = parts;
  if (!isSource(source)) {
    throw new Error(`invalid event name (unknown source '${source}'): ${name}`);
  }
  const action = rest[rest.length - 1];
  const subject = rest.slice(0, -1).join(".");
  return { source, subject, action };
}

export function isValidEventName(name: string): boolean {
  try {
    parseEventName(name);
    return true;
  } catch {
    return false;
  }
}
