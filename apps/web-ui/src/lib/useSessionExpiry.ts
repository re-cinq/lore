"use client";

import { useEffect, useState } from "react";
import { sessionEnded, timerDelayMs, type SessionEnd } from "./session-expiry";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const ASK_DEADLINE_MS = 10_000;

/** How the tab's session ended, or null while it stands. */
export function useSessionExpiry(expiresAt: string | null): SessionEnd | null {
  const [end, setEnd] = useState<SessionEnd | null>(null);

  useEffect(
    () => (end ? undefined : watchSession(expiresAt, setEnd)),
    [expiresAt, end],
  );

  return end;
}

/** Looks at the session when its time is up, every five minutes, and each time the person returns to the tab; answers how to stop looking. */
function watchSession(
  expiresAt: string | null,
  onLooked: (end: SessionEnd | null) => void,
): () => void {
  const look = () => void sessionEndNow(expiresAt).then(onLooked);
  const atItsEnd = setTimeout(look, timerDelayMs(expiresAt, Date.now()));
  const everySoOften = setInterval(look, CHECK_EVERY_MS);

  document.addEventListener("visibilitychange", look);

  return () => {
    clearTimeout(atItsEnd);
    clearInterval(everySoOften);
    document.removeEventListener("visibilitychange", look);
  };
}

/** A hidden tab asks nothing. The tab's own clock answers first, so a tab with no network still learns its time is up. */
async function sessionEndNow(
  expiresAt: string | null,
): Promise<SessionEnd | null> {
  if (document.visibilityState !== "visible") {
    return null;
  }

  return sessionEnded(expiresAt, Date.now()) ? "timed-out" : askedEnd();
}

/** "signed-out" when the server says the session is gone; null when it stands, and null when the server could not be asked, which says nothing about the session. */
async function askedEnd(): Promise<SessionEnd | null> {
  const answer = await fetch("/api/auth/session", {
    cache: "no-store",
    signal: AbortSignal.timeout(ASK_DEADLINE_MS),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);

  return answer?.signed_in === false ? "signed-out" : null;
}
