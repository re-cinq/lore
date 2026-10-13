// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SaveResultBanner, { INITIAL_SAVE_STATE } from "./SaveResultBanner";

describe("SaveResultBanner", () => {
  it("renders nothing before a save", () => {
    const { container } = render(
      <SaveResultBanner state={INITIAL_SAVE_STATE} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the saved confirmation after a save", () => {
    render(<SaveResultBanner state={{ saved: true }} />);
    expect(screen.getByText("Settings saved.")).toBeInTheDocument();
  });

  it("shows what the save path said is missing when it refused", () => {
    // @ts-expect-error -- We're passing an error property that isn't in the interface yet
    render(
      <SaveResultBanner
        state={{ saved: false, error: "Missing rule: requires 1 approval" }}
      />,
    );
    expect(
      screen.getByText(/Missing rule: requires 1 approval/),
    ).toBeInTheDocument();
  });
});
