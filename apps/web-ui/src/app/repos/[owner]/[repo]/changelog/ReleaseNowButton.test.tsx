// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ReleaseNowButton from "./ReleaseNowButton";
import type { ReleaseNow, ReleaseNowResult } from "./release-now-outcome";

function button(
  props: { unreleased: number | null; latestVersion?: string | null },
  releaseNow: ReleaseNow = () =>
    Promise.resolve({ ok: true, runId: "run-7", joined: false }),
) {
  return render(
    <ReleaseNowButton
      unreleased={props.unreleased}
      latestVersion={props.latestVersion ?? null}
      releaseNow={releaseNow}
    />,
  );
}

describe("ReleaseNowButton", () => {
  it("is disabled and reads Nothing merged since v1.2.0 with 0 unreleased", () => {
    button({ unreleased: 0, latestVersion: "v1.2.0" });

    expect(
      screen.getByRole("button", { name: "Nothing merged since v1.2.0" }),
    ).toBeDisabled();
  });

  it("is disabled and reads Nothing merged yet with 0 unreleased and no release", () => {
    button({ unreleased: 0 });

    expect(
      screen.getByRole("button", { name: "Nothing merged yet" }),
    ).toBeDisabled();
  });

  it("shows 3 changes unreleased beside an enabled Release now", () => {
    button({ unreleased: 3, latestVersion: "v1.2.0" });

    expect({
      count: screen.getByText("3 changes unreleased").textContent,
      disabled: screen.getByRole("button", { name: "Release now" }),
    }).toMatchObject({
      count: "3 changes unreleased",
      disabled: { disabled: false },
    });
  });

  it("says 1 change unreleased for a single one", () => {
    button({ unreleased: 1 });

    expect(screen.getByText("1 change unreleased")).toBeInTheDocument();
  });

  it("is enabled and shows no count when the unreleased count is unknown", () => {
    button({ unreleased: null });

    expect({
      enabled: !screen
        .getByRole("button", { name: "Release now" })
        .hasAttribute("disabled"),
      count: screen.queryByText(/unreleased/),
    }).toEqual({ enabled: true, count: null });
  });

  it("shows Starting the release and cannot be pressed again while the request runs", async () => {
    let finish: (result: ReleaseNowResult) => void = () => {};
    let presses = 0;

    button({ unreleased: 2 }, () => {
      presses += 1;

      return new Promise((resolve) => (finish = resolve));
    });
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));
    const pending = await screen.findByRole("button", {
      name: "Starting the release…",
    });

    fireEvent.click(pending);
    finish({ ok: true, runId: "run-7", joined: false });

    expect({ disabled: pending, presses }).toMatchObject({
      disabled: { disabled: true },
      presses: 1,
    });
  });

  it("links to /assembly-runs/run-7 once the release started", async () => {
    button({ unreleased: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));

    expect({
      href: (await screen.findByRole("link", { name: /run/i })).getAttribute(
        "href",
      ),
      said: screen.getByText(/Release started/).textContent,
    }).toEqual({
      href: "/assembly-runs/run-7",
      said: "Release started: Open the run",
    });
  });

  it("says it joined the run already open for this commit", async () => {
    button({ unreleased: 2 }, () =>
      Promise.resolve({ ok: true, runId: "run-9", joined: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));

    expect(
      (await screen.findByText(/already open for this commit/)).textContent,
    ).toBe("A release run is already open for this commit: Open the run");
  });

  it("shows the sentence for a 409 and lets the button be pressed again", async () => {
    button({ unreleased: 2 }, () =>
      Promise.resolve({
        ok: false,
        said: "Could not start the release: this repository is another repository's public mirror, and that one is released instead.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));

    expect({
      said: (await screen.findByRole("alert")).textContent,
      again: screen.getByRole("button", { name: "Release now" }),
    }).toMatchObject({
      said: "Could not start the release: this repository is another repository's public mirror, and that one is released instead.",
      again: { disabled: false },
    });
  });

  it("shows the sentence for a 503", async () => {
    button({ unreleased: 2 }, () =>
      Promise.resolve({
        ok: false,
        said: "Could not start the release: Lore has no floor or database to run it on right now. Try again in a minute.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /no floor or database/,
    );
  });
});
