"use client";

import SessionEndedDialog from "@/components/SessionEndedDialog";
import { sessionLengthLabel, signInAgainPath } from "@/lib/session-expiry";
import { useSessionExpiry } from "@/lib/useSessionExpiry";

interface SessionWatchProps {
  startedAt: string;
  expiresAt: string | null;
}

/** Watches the signed-in person's session from the tab and says so when it ends, in place of the failed request a button on a stale page would meet. */
export default function SessionWatch({
  startedAt,
  expiresAt,
}: SessionWatchProps) {
  const end = useSessionExpiry(expiresAt);

  if (!end) {
    return null;
  }
  const { pathname, search } = window.location;

  return (
    <SessionEndedDialog
      end={end}
      lengthLabel={sessionLengthLabel(startedAt, expiresAt)}
      signInHref={signInAgainPath(pathname, search)}
    />
  );
}
