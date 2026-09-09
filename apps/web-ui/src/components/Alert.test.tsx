// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert";

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
