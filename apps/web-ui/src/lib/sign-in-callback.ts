export type SignInFailure = "not_in_org" | "github_denied" | "state_expired";

export type CallbackAction =
  | { action: "redeem"; code: string }
  | { action: "failed"; reason: SignInFailure }
  | { action: "invalid" };

const FAILURES: SignInFailure[] = [
  "not_in_org",
  "github_denied",
  "state_expired",
];

/** What the sign-in's return trip asks of the UI: swap a code for a session, show why it failed, or nothing sensible. */
export function callbackAction(query: URLSearchParams): CallbackAction {
  const failure = query.get("auth_error");
  const code = query.get("code");

  if (failure) {
    return { action: "failed", reason: failureOf(failure) };
  }

  return code ? { action: "redeem", code } : { action: "invalid" };
}

export function signInFailureMessage(reason: SignInFailure): string {
  return MESSAGES[reason];
}

/** A reason the UI does not know is GitHub's refusal, never an error page of its own. */
export function failureOf(reason: string): SignInFailure {
  return FAILURES.find((known) => known === reason) ?? "github_denied";
}

const MESSAGES: Record<SignInFailure, string> = {
  not_in_org:
    "Your GitHub account is not a member of the organisation that runs this Lore.",
  state_expired: "The sign-in took too long. Start again.",
  github_denied: "GitHub did not complete the sign-in.",
};
