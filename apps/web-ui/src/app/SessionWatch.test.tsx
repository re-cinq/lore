// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import SessionWatch from "./SessionWatch";

const SESSION = {
  startedAt: "2026-10-28T10:00:00.000Z",
  expiresAt: "2026-10-28T18:00:00.000Z",
};

function sessionRoute(answer: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answer()),
  );
}

const signedIn = () =>
  Response.json({ signed_in: true, expires_at: SESSION.expiresAt });
const signedOut = () => Response.json({ signed_in: false, expires_at: null });

const dialogTitle = () => screen.queryByRole("heading")?.textContent ?? null;

async function returnToTab() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("SessionWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-28T17:00:00Z") });
    window.history.pushState({}, "", "/repos/re-cinq/lore/plans/p1?tab=notes");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows nothing at 17:00 for a session that ends at 18:00", () => {
    sessionRoute(signedIn);
    render(<SessionWatch {...SESSION} />);

    expect(dialogTitle()).toBeNull();
  });

  it("shows the dialog at 18:00, with a link back to the page and its query", async () => {
    sessionRoute(signedIn);
    render(<SessionWatch {...SESSION} />);

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));

    expect({
      title: dialogTitle(),
      body: screen.getByText(/run out/).textContent,
      href: screen.getByRole("link").getAttribute("href"),
    }).toEqual({
      title: "Your session has ended",
      body: "Sign-ins last 8 hours, and yours has run out. Sign in again to carry on; this page opens again where you were.",
      href: "/auth/signin?next=%2Frepos%2Fre-cinq%2Flore%2Fplans%2Fp1%3Ftab%3Dnotes",
    });
  });

  it("shows the signed-out dialog on return to a tab whose session was ended elsewhere", async () => {
    sessionRoute(signedOut);
    render(<SessionWatch {...SESSION} />);

    await returnToTab();

    expect(screen.getByText(/signed out/)).toBeInTheDocument();
  });

  it("shows the signed-out dialog at the 5 minute check when the session was ended early", async () => {
    sessionRoute(signedOut);
    render(<SessionWatch {...SESSION} />);

    await act(() => vi.advanceTimersByTimeAsync(5 * 60 * 1000));

    expect(screen.getByText(/signed out/)).toBeInTheDocument();
  });

  it("shows nothing when the check cannot reach the server", async () => {
    sessionRoute(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<SessionWatch {...SESSION} />);

    await returnToTab();

    expect(dialogTitle()).toBeNull();
  });

  it("shows nothing when the server answers 503 for the check", async () => {
    sessionRoute(() => Response.json({ error: "x" }, { status: 503 }));
    render(<SessionWatch {...SESSION} />);

    await returnToTab();

    expect(dialogTitle()).toBeNull();
  });
});
