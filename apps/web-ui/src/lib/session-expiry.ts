// When a person's sign-in ends, as the browser tab reasons about it: the session's end comes from lore-api, the clock is the tab's.

/** How a session came to its end: its time ran out, or it was ended before that (a sign-out in another tab, a removed token). */
export type SessionEnd = "timed-out" | "signed-out";

/** A browser timer set for longer than this fires at once. */
const LONGEST_TIMER_MS = 2_147_483_647;

const HOUR_MS = 60 * 60 * 1000;
const HOURS_A_DAY = 24;

export function sessionEnded(expiresAt: string | null, now: number): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now;
}

/** How long a timer set now waits for the session's end; a session with no end is looked at again when the longest timer fires. */
export function timerDelayMs(expiresAt: string | null, now: number): number {
  const left =
    expiresAt === null ? LONGEST_TIMER_MS : new Date(expiresAt).getTime() - now;

  return Math.min(Math.max(left, 0), LONGEST_TIMER_MS);
}

/** The sign-in page, told which page to come back to; the same shape the middleware sends a request without a session to. */
export function signInAgainPath(pathname: string, search: string): string {
  return `/auth/signin?next=${encodeURIComponent(pathname + search)}`;
}

/** A session's length in the words the settings page offers it in: "8 hours", "1 day", "7 days". */
export function sessionLengthLabel(
  startedAt: string,
  expiresAt: string | null,
): string {
  const hours = Math.round(
    (new Date(expiresAt ?? startedAt).getTime() -
      new Date(startedAt).getTime()) /
      HOUR_MS,
  );

  return hours < HOURS_A_DAY
    ? counted(hours, "hour")
    : counted(Math.round(hours / HOURS_A_DAY), "day");
}

function counted(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
