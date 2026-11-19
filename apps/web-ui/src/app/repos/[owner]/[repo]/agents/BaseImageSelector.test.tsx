// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BaseImageSelector from "./BaseImageSelector";

describe("BaseImageSelector", () => {
  it("renders a select named base_image with platform-published image options", () => {
    const { container } = render(<BaseImageSelector value={null} />);
    const select = container.querySelector('select[name="base_image"]');

    expect(select).not.toBeNull();
    const options = Array.from(
      container.querySelectorAll('select[name="base_image"] option'),
    );

    expect(options.length).toBeGreaterThan(1);
    expect(options.some((o) => (o as HTMLOptionElement).value !== "")).toBe(
      true,
    );
  });

  it("does not render a free-form text input for base_image", () => {
    const { container } = render(<BaseImageSelector value={null} />);

    expect(
      container.querySelector('input[name="base_image"][type="text"]'),
    ).toBeNull();
  });

  it("pre-selects the given value", () => {
    const { container } = render(<BaseImageSelector value="node:20-alpine" />);
    const select = container.querySelector(
      'select[name="base_image"]',
    ) as HTMLSelectElement;

    expect(select.value).toBe("node:20-alpine");
  });
});
