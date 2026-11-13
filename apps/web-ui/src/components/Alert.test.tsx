// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

describe("Alert", () => {
  it("renders an info status region with the message by default", () => {
    render(<Alert>Ingest is still running.</Alert>);

    const alert = screen.getByRole("status");

    expect(alert).toHaveTextContent("Ingest is still running.");
    expect(alert.className).toContain("info");
  });

  it("renders the secondary variant when asked", () => {
    render(<Alert variant="secondary">This run has no backing task.</Alert>);

    expect(screen.getByRole("status").className).toContain("secondary");
  });
});

describe("Alert warning", () => {
  it("renders the warning variant as an alert region led by a warning icon", () => {
    render(<Alert variant="warning">The agent could not refine Scope.</Alert>);

    const alert = screen.getByRole("alert");

    expect({
      text: alert.textContent,
      icon: alert.querySelector("[data-testid]")?.getAttribute("data-testid"),
    }).toEqual({
      text: "The agent could not refine Scope.",
      icon: "icon-warning",
    });
  });
});
