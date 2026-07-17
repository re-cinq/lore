// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AdrMetaView from "./AdrMetaView";

const meta = {
  adr_number: "32",
  status: "draft",
  date: "2026-06-23",
  domains: ["mcp-server", "api"],
  relates: "specs/split-local-remote-api/spec.md",
  amends: "adrs/ADR-016-dark-factory-mode.md",
};

describe("AdrMetaView", () => {
  it("renders the status pill, date, and domain chips", () => {
    render(<AdrMetaView owner="re-cinq" repo="lore" meta={meta} />);

    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("2026-06-23")).toBeTruthy();
    expect(screen.getByText("mcp-server")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });

  it("links relates to the owning spec detail and amends to the ADR detail", () => {
    render(<AdrMetaView owner="re-cinq" repo="lore" meta={meta} />);

    expect(
      screen
        .getByText("specs/split-local-remote-api/spec.md")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      `/repos/re-cinq/lore/specs/${encodeURIComponent("specs/split-local-remote-api/spec.md")}`,
    );
    expect(
      screen
        .getByText("adrs/ADR-016-dark-factory-mode.md")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      `/repos/re-cinq/lore/adrs/${encodeURIComponent("adrs/ADR-016-dark-factory-mode.md")}`,
    );
  });

  it("omits absent keys and renders nothing for empty meta", () => {
    const { container } = render(
      <AdrMetaView owner="re-cinq" repo="lore" meta={{}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("skips the pill for an unrecognized status but keeps the rest", () => {
    render(
      <AdrMetaView
        owner="re-cinq"
        repo="lore"
        meta={{ status: "contemplating", date: "2026-01-01" }}
      />,
    );

    expect(screen.queryByText("Contemplating")).toBeNull();
    expect(screen.getByText("2026-01-01")).toBeTruthy();
  });
});
