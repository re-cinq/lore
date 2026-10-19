// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PRStatusBadge from "./PRStatusBadge";

describe("PRStatusBadge", () => {
  it("renders nothing when status is null", () => {
    const { container } = render(<PRStatusBadge status={null} />);

    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when status is an empty string", () => {
    const { container } = render(<PRStatusBadge status="" />);

    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("renders the status pill with the status text", () => {
    render(<PRStatusBadge status="open" />);
    const pill = screen.getByText("open");

    expect(pill).toHaveClass("status-pill");
  });

  const knownStatuses: Array<[string, string]> = [
    ["draft", "var(--text-muted)"],
    ["open", "var(--info)"],
    ["checks-failing", "var(--danger)"],
    ["changes-requested", "var(--warning)"],
    ["approved", "var(--success)"],
    ["merged", "var(--accent)"],
    ["closed", "var(--border-hover)"],
  ];

  it.each(knownStatuses)(
    "maps the %s status to its pill color",
    (status, color) => {
      render(<PRStatusBadge status={status} />);
      const pill = screen.getByText(status);

      expect(pill.style.getPropertyValue("--pill-color")).toBe(color);
    },
  );

  it("falls back to the muted color for an unknown status", () => {
    render(<PRStatusBadge status="totally-unknown" />);
    const pill = screen.getByText("totally-unknown");

    expect(pill.style.getPropertyValue("--pill-color")).toBe(
      "var(--text-muted)",
    );
  });
});
