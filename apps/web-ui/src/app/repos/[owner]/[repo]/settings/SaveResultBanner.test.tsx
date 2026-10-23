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

  it("shows lore-api's reason when it refused the save", () => {
    render(
      <SaveResultBanner
        state={{
          saved: false,
          error: "context_backend must be lore, utopia or both",
        }}
      />,
    );
    expect(
      screen.getByText(/context_backend must be lore, utopia or both/),
    ).toBeInTheDocument();
  });
});
