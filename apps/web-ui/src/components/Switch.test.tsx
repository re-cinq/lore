// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Switch from "./Switch";

describe("Switch", () => {
  it("renders a checkbox named and labelled as given", () => {
    render(<Switch name="auto" label="Auto review" defaultChecked={false} />);

    expect(
      screen.getByRole("checkbox", { name: "Auto review" }),
    ).toHaveAttribute("name", "auto");
  });

  it("starts checked when defaultChecked is true", () => {
    render(<Switch name="auto" label="Auto review" defaultChecked />);

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("starts unchecked when defaultChecked is false", () => {
    render(<Switch name="auto" label="Auto review" defaultChecked={false} />);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("posts the given value when on", () => {
    render(<Switch name="auto" label="L" defaultChecked value="yes" />);

    expect(screen.getByRole("checkbox")).toHaveAttribute("value", "yes");
  });

  it("renders the detail text when given", () => {
    render(
      <Switch name="a" label="L" detail="Explains it" defaultChecked={false} />,
    );

    expect(screen.getByText("Explains it")).toBeInTheDocument();
  });

  it("renders no detail when none is given", () => {
    const { container } = render(
      <Switch name="a" label="L" defaultChecked={false} />,
    );

    expect(container.querySelectorAll("label > span > span")).toHaveLength(1);
  });
});
