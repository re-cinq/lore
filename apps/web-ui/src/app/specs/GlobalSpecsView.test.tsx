// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("counts statuses into chips and filters the list when a status chip is clicked", () => {
    const { container } = render(
      <GlobalSpecsView
        specs={[
          { repo: "re-cinq/lore", filePath: "specs/auth/spec.md" },
          { repo: "re-cinq/lore", filePath: "specs/pay/spec.md" },
        ]}
        statuses={{
          "re-cinq/lore::specs/auth/spec.md": {
            status: "shipped",
            label: "Shipped",
          },
          "re-cinq/lore::specs/pay/spec.md": {
            status: "draft",
            label: "Draft",
          },
        }}
      />,
    );

    expect(container.querySelectorAll(".status-pill")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /Shipped \(1\)/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Shipped \(1\)/ }));

    expect(screen.getByText("specs/auth/spec.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/pay/spec.md")).not.toBeInTheDocument();
  });
});
