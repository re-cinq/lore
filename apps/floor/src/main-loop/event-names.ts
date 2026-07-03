/**
 * Event sources for the Floor event bus. Event names are usually
 * `source.subject.action`, where the source prefix is globally unique so a name
 * on one source can never collide with another (e.g. `github.pull_request.closed`
 * vs `kubernetes.agent.succeeded`). The registry keys on the full name.
 *
 * Exception: the `assembly_line.*` family is subject-first, not source-prefixed —
 * the assembly line is a primary concept whose start events come from multiple
 * producers (worker, station backend, future API), all with `source: "internal"`.
 */

export const SOURCES = ["github", "kubernetes", "cron", "internal"] as const;
export type EventSource = (typeof SOURCES)[number];
