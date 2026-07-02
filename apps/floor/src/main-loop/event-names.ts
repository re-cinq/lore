/**
 * Event sources for the Floor event bus. Event names are `source.subject.action`,
 * where the source prefix is globally unique so a name on one source can never
 * collide with another (e.g. `github.pull_request.closed` vs
 * `kubernetes.agent.succeeded`). The registry keys on the full name.
 */

export const SOURCES = ["github", "kubernetes", "cron", "internal"] as const;
export type EventSource = (typeof SOURCES)[number];
