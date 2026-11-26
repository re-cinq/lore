// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SidebarVersion from "./SidebarVersion";

afterEach(cleanup);

const RELEASES_URL = "https://github.com/re-cinq/lore/releases";
const NOTES_URL = "https://github.com/re-cinq/lore/releases/tag/v1.3.0";

describe("SidebarVersion", () => {
  it("shows Lore v1.3.0 and the Releases link when no update is available", () => {
    render(
      <SidebarVersion
        running="v1.3.0"
        releasesUrl={RELEASES_URL}
        update={null}
      />,
    );

    expect(screen.getByText("Lore v1.3.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Releases" })).toHaveAttribute(
      "href",
      RELEASES_URL,
    );
    expect(screen.queryByText(/Update available/)).toBeNull();
  });

  it("shows the Update available: v1.3.0 badge linking to its notes when running v1.2.3", () => {
    render(
      <SidebarVersion
        running="v1.2.3"
        releasesUrl={RELEASES_URL}
        update={{ tag: "v1.3.0", url: NOTES_URL }}
      />,
    );

    expect(screen.getByText("Lore v1.2.3")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Update available: v1.3.0" }),
    ).toHaveAttribute("href", NOTES_URL);
  });

  it("shows the short SHA 0caa086 as the build and no badge for a SHA build", () => {
    render(
      <SidebarVersion
        running="0caa086"
        releasesUrl={RELEASES_URL}
        update={null}
      />,
    );

    expect(screen.getByText("Lore 0caa086")).toBeInTheDocument();
    expect(screen.queryByText(/Update available/)).toBeNull();
  });
});
