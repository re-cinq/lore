// How long a person's web sign-in lasts: the org settings page picks one of these lengths, and a sign-in started with nothing saved lasts the default.

export const SESSION_LENGTH_KEY = "session_length_hours";

/** What the settings page offers: 8 hours, a day, a week, 30 days. */
export const SESSION_LENGTH_HOURS = [8, 24, 168, 720] as const;

export const DEFAULT_SESSION_LENGTH_HOURS = 8;

const HOUR_MS = 60 * 60 * 1000;

/** The length a sign-in gets from the saved setting; a missing value, or one the page never offers, gives the default. */
export function sessionLengthMs(saved: string | undefined): number {
  const hours = Number(saved);

  return (offered(hours) ? hours : DEFAULT_SESSION_LENGTH_HOURS) * HOUR_MS;
}

/** Why an org settings write of `key` = `value` is refused, or null when it is not; a blank value is the form's "leave it alone" and never refused. */
export function sessionLengthError(key: string, value: string): string | null {
  return key === SESSION_LENGTH_KEY && value !== "" && !offered(Number(value))
    ? `${SESSION_LENGTH_KEY} must be ${SESSION_LENGTH_HOURS.slice(0, -1).join(", ")} or ${SESSION_LENGTH_HOURS.at(-1)}`
    : null;
}

function offered(hours: number): boolean {
  return (SESSION_LENGTH_HOURS as readonly number[]).includes(hours);
}
