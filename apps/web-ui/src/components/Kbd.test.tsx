// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Kbd from "./Kbd";

describe("Kbd", () => {
  it("renders its key inside a kbd element", () => {
    render(<Kbd>esc</Kbd>);

    expect(screen.getByText("esc").tagName).toBe("KBD");
  });
});
