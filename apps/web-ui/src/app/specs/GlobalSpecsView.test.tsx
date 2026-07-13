// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GlobalSpecsView from "./GlobalSpecsView";

describe("GlobalSpecsView", () => {
  it("groups specs by repo and links each path to the per-repo graph detail", () => {
    render(
      <GlobalSpecsView
        specs={[
          { repo: "re-cinq/lore", filePath: "specs/auth/spec.md" },
          { repo: "re-cinq/lore", filePath: ".specify/spec.md" },
          { repo: "acme/widgets", filePath: "specs/x.md" },
        ]}
      />,
    );
    expect(screen.getByText("re-cinq/lore")).toBeTruthy();
    expect(screen.getByText("acme/widgets")).toBeTruthy();
    const link = screen.getByText("specs/auth/spec.md").closest("a");

    expect(link?.getAttribute("href")).toBe(
      `/repos/re-cinq/lore/specs/${encodeURIComponent("specs/auth/spec.md")}`,
    );
  });

  it("shows an empty-state hint when the graph holds no specs", () => {
    render(<GlobalSpecsView specs={[]} />);
    expect(screen.getByText(/no specs in the graph/i)).toBeTruthy();
  });
});
