// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormError } from "./FormError";

describe("FormError", () => {
  it("renders nothing when there is no error", () => {
    const { container } = render(<FormError />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a null message", () => {
    // Result unions hand back null as often as undefined.
    const { container } = render(<FormError message={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty message rather than an empty red box", () => {
    const { container } = render(<FormError message="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("announces the message so a screen reader hears the failure", () => {
    // The hand-rolled copies were plain <p>s: a submit that failed was silent
    // unless you happened to be looking at that part of the page.
    render(<FormError message="Title and prompt are required." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Title and prompt are required.",
    );
  });

  it("keeps a caller's class alongside its own", () => {
    render(<FormError message="boom" className="formActions" />);
    expect(screen.getByRole("alert").className).toContain("formActions");
  });
});
