// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Panel, { PanelTable } from "./Panel";

describe("Panel", () => {
  it("renders its title as a heading above its children", () => {
    render(<Panel title="Events">body text</Panel>);

    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByText("body text")).toBeInTheDocument();
  });

  it("renders the head link when given a link", () => {
    render(
      <Panel title="Tasks" link={{ href: "/tasks", text: "All tasks →" }}>
        x
      </Panel>,
    );

    expect(screen.getByRole("link", { name: "All tasks →" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("renders no link when none is given", () => {
    render(<Panel title="Tasks">x</Panel>);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("names the section by its heading when given a headingId", () => {
    render(
      <Panel title="Triage" headingId="triage-h">
        x
      </Panel>,
    );

    expect(screen.getByRole("region", { name: "Triage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Triage" })).toHaveAttribute(
      "id",
      "triage-h",
    );
  });

  it("adds the caller's className and the soft class to the section", () => {
    const { container } = render(
      <Panel title="Side" className="extra" soft>
        x
      </Panel>,
    );

    expect(container.querySelector("section")?.className).toMatch(
      /panel.*soft.*extra/,
    );
  });

  it("carries only the panel class when no className and not soft", () => {
    const { container } = render(<Panel title="Plain">x</Panel>);

    expect(container.querySelector("section")?.className).toMatch(
      /^_panel_\w+$/,
    );
  });
});

describe("PanelTable", () => {
  it("wraps its table", () => {
    render(
      <PanelTable>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </PanelTable>,
    );

    expect(screen.getByRole("cell", { name: "cell" })).toBeInTheDocument();
  });
});
