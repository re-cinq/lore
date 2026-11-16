// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionEndedDialog from "./SessionEndedDialog";

describe("SessionEndedDialog", () => {
  it("says a sign-in of 8 hours has run out", () => {
    render(
      <SessionEndedDialog
        end="timed-out"
        lengthLabel="8 hours"
        signInHref="/auth/signin?next=%2Fsettings"
      />,
    );

    expect({
      title: screen.getByRole("heading").textContent,
      body: screen.getByText(/run out/).textContent,
    }).toEqual({
      title: "Your session has ended",
      body: "Sign-ins last 8 hours, and yours has run out. Sign in again to carry on; this page opens again where you were.",
    });
  });

  it("says the person was signed out when the session ended before its time", () => {
    render(
      <SessionEndedDialog
        end="signed-out"
        lengthLabel="8 hours"
        signInHref="/auth/signin?next=%2Fsettings"
      />,
    );

    expect(screen.getByText(/signed out/).textContent).toBe(
      "You have been signed out. Sign in again to carry on; this page opens again where you were.",
    );
  });

  it("links Sign in again to the sign-in page for /settings", () => {
    render(
      <SessionEndedDialog
        end="timed-out"
        lengthLabel="8 hours"
        signInHref="/auth/signin?next=%2Fsettings"
      />,
    );

    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/auth/signin?next=%2Fsettings",
    );
  });
});
