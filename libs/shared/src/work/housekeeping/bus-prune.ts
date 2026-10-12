// The hourly housekeeping of the event bus and of what agent runs leave behind: handled deliveries are pruned, the two silent failures (an event nobody subscribes to, a handler that gave up) are said out loud, and per-tool-call events and full transcripts age out on their own windows.
import type { EventDeliveriesPort } from "../../outbound/project/events/event-deliveries-port.js";

/** Handled deliveries are kept a week: long enough to read back an incident, short enough to keep the claim index small. */
const HANDLED_RETENTION_DAYS = 7;

/** Agent run events are per-tool-call telemetry: high volume, low half-life. */
const AGENT_RUN_EVENT_RETENTION_DAYS = 14;

/** Full-fidelity transcript retention (configurable via LORE_AGENT_RUN_TURN_RETENTION_DAYS). */
const DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS = 30;

/** Postgres `make_interval` takes int32; an absurd override falls back rather than failing the hourly tick. */
const MAX_AGENT_RUN_TURN_RETENTION_DAYS = 3650;

/** The report windows match the hourly tick, so no window is skipped or reported twice. */
const ORPHAN_WINDOW_MINUTES = 60;
const DEAD_LETTER_WINDOW_MINUTES = 60;

interface Prunable {
  pruneOld(olderThanDays: number): Promise<number>;
}

export interface BusPruneDeps {
  deliveries: Pick<
    EventDeliveriesPort,
    "pruneHandled" | "orphanedEvents" | "deadLettered"
  >;
  agentRunEvents: Prunable;
  agentRunTurns: Prunable;
}

type RetentionEnv = { LORE_AGENT_RUN_TURN_RETENTION_DAYS?: string };

export async function pruneBus(
  deps: BusPruneDeps,
  env: RetentionEnv = process.env,
): Promise<string> {
  const handled = await deps.deliveries.pruneHandled(HANDLED_RETENTION_DAYS);

  if (handled > 0) {
    console.log(`[events] pruned ${handled} handled delivery(ies)`);
  }

  await reportOrphanedEvents(deps);
  await reportDeadLetters(deps);
  await pruneAgentRunRetention(deps, env);

  return `pruned ${handled} handled delivery(ies)`;
}

// Report unclaimed event names to prevent silent producer failures.
async function reportOrphanedEvents({
  deliveries,
}: BusPruneDeps): Promise<void> {
  const orphaned = await deliveries.orphanedEvents(ORPHAN_WINDOW_MINUTES);

  if (orphaned.length === 0) {
    return;
  }
  const detail = orphaned.map((o) => `${o.event_name} x${o.count}`).join(", ");

  console.error(
    `[events] ${orphaned.length} event name(s) reached nobody in the last ${ORPHAN_WINDOW_MINUTES}m — no subscriber is registered for: ${detail}`,
  );
}

/** Report handlers that gave up, so a failing safety net is not discovered by its silence. The reconcile tick dead-lettered 84 deliveries across a 3-hour cluster-agent outage (2026-09-08) and said nothing an operator would see; the rows were the only record. Grouped and periodic rather than per-row, because an outage produces one identical failure a minute. */
async function reportDeadLetters({ deliveries }: BusPruneDeps): Promise<void> {
  const dead = await deliveries.deadLettered(DEAD_LETTER_WINDOW_MINUTES);

  if (dead.length === 0) {
    return;
  }
  const detail = dead
    .map((d) => `${d.event_name} x${d.count} (${d.last_error ?? "no error"})`)
    .join(", ");

  console.error(
    `[events] ${dead.length} handler(s) gave up in the last ${DEAD_LETTER_WINDOW_MINUTES}m — dead-lettered: ${detail}`,
  );
}

/** Per-tool-call events and full transcripts age out on their own retention windows. */
async function pruneAgentRunRetention(
  deps: BusPruneDeps,
  env: RetentionEnv,
): Promise<void> {
  const runEvents = await deps.agentRunEvents.pruneOld(
    AGENT_RUN_EVENT_RETENTION_DAYS,
  );

  if (runEvents > 0) {
    console.log(`[events] pruned ${runEvents} agent run event(s)`);
  }

  const runTurns = await deps.agentRunTurns.pruneOld(turnRetentionDays(env));

  if (runTurns > 0) {
    console.log(`[events] pruned ${runTurns} agent run turn(s)`);
  }
}

function turnRetentionDays(env: RetentionEnv): number {
  const raw = env.LORE_AGENT_RUN_TURN_RETENTION_DAYS;

  if (raw === undefined) {
    return DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS;
  }
  const parsed = Number(raw);

  if (
    Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_AGENT_RUN_TURN_RETENTION_DAYS
  ) {
    return parsed;
  }
  console.warn(
    `[events] ignoring LORE_AGENT_RUN_TURN_RETENTION_DAYS=${raw}: not an integer in 1..${MAX_AGENT_RUN_TURN_RETENTION_DAYS}, keeping ${DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS}`,
  );

  return DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS;
}
