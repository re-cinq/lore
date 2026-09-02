// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the label styled by the ok tone", () => {
    render(<StatusPill label="succeeded" tone="ok" />);

    const pill = screen.getByText("succeeded");

    expect(pill.className).toContain("pill");
    expect(pill.className).toContain("ok");
  });

  it("renders the label styled by the err tone", () => {
    render(<StatusPill label="failed" tone="err" />);

    expect(screen.getByText("failed").className).toContain("err");
  });
});
