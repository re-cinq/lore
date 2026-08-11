import { describe, it, expect } from "vitest";
import {
  DEFAULT_MOCKUP_HEIGHT,
  mockupFrameSrcdoc,
  mockupHeight,
} from "./mockup-frame";

describe("mockupFrameSrcdoc", () => {
  it("puts the planned repo's stylesheet after the reset so the repo wins", () => {
    const doc = mockupFrameSrcdoc(
      "<div class='card'>hi</div>",
      ".card { color: red; }",
    );

    expect(doc.indexOf("box-sizing")).toBeLessThan(
      doc.indexOf(".card { color: red; }"),
    );
  });

  it("renders the markup verbatim inside the document body", () => {
    expect(mockupFrameSrcdoc("<div class='card'>hi</div>")).toContain(
      "<div class='card'>hi</div>",
    );
  });

  it("borrows none of the dashboard's own theme tokens", () => {
    // A mockup is a picture of the PLANNED repo. Injecting Lore's palette would dress
    // a backend repo's plain HTML as something it is not.
    const doc = mockupFrameSrcdoc("<div>hi</div>");

    expect(doc).not.toContain("var(--accent)");
    expect(doc).not.toContain("var(--bg-surface)");
  });

  it("keeps a diagram inside the frame's width", () => {
    expect(mockupFrameSrcdoc("<svg/>")).toContain("max-width: 100%");
  });

  it("declares a transparent ground so the frame does not punch a white hole", () => {
    expect(mockupFrameSrcdoc("<div>hi</div>")).toContain(
      "background: transparent",
    );
  });
});

describe("mockupHeight", () => {
  it("uses the height the agent declared for an html mockup", () => {
    expect(
      mockupHeight({ format: "html", markup: "<div/>", height: 180 }),
    ).toBe(180);
  });

  it("falls back to the default when no height was declared", () => {
    // The frame is sandboxed without same-origin access, so it cannot measure
    // itself — an undeclared height has to be guessed, never computed.
    expect(mockupHeight({ format: "html", markup: "<div/>" })).toBe(
      DEFAULT_MOCKUP_HEIGHT,
    );
  });

  it("ignores a nonsensical height rather than collapsing the frame", () => {
    expect(mockupHeight({ format: "html", markup: "<div/>", height: 0 })).toBe(
      DEFAULT_MOCKUP_HEIGHT,
    );
  });

  it("caps an absurd height so one mockup cannot own the page", () => {
    expect(
      mockupHeight({ format: "html", markup: "<div/>", height: 99999 }),
    ).toBe(2000);
  });
});
