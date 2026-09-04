// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MockupSection from "./MockupSection";
import type { GapMockup } from "@/lib/feature-types";

const mockup = (over: Partial<GapMockup> = {}): GapMockup => ({
  title: "",
  format: "svg",
  markup: "<svg></svg>",
  ...over,
});

describe("MockupSection", () => {
  it("titles a mockup by its position when it carries no title", () => {
    render(<MockupSection mockups={[mockup()]} />);

    expect(screen.getByText("Mockup 1")).toBeInTheDocument();
  });

  it("uses the mockup's own title when it has one", () => {
    render(<MockupSection mockups={[mockup({ title: "Login screen" })]} />);

    expect(screen.getByText("Login screen")).toBeInTheDocument();
    expect(screen.queryByText("Mockup 1")).toBeNull();
  });

  it("falls back to the default frame height for a non-mermaid mockup", () => {
    render(<MockupSection mockups={[mockup({ format: "html" })]} />);

    expect(screen.getByTitle("Mockup 1")).toHaveAttribute("height");
  });

  it("uses the mockup's declared height when the html mockup sets one", () => {
    render(
      <MockupSection mockups={[mockup({ format: "html", height: 640 })]} />,
    );

    expect(screen.getByTitle("Mockup 1")).toHaveAttribute("height", "640");
  });
});
