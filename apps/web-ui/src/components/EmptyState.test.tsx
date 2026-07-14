// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title on its own", () => {
    render(<EmptyState title="No assembly lines yet" />);
    expect(screen.getByText("No assembly lines yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the optional description", () => {
    render(
      <EmptyState
        title="No pools yet"
        description="Pools are created by agents."
      />,
    );
    expect(
      screen.getByText("Pools are created by agents."),
    ).toBeInTheDocument();
  });

  it("renders the optional action link", () => {
    render(
      <EmptyState
        title="No tasks"
        action={{ href: "/create", label: "Create one" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute(
      "href",
      "/create",
    );
  });
});
