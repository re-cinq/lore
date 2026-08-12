import { describe, it, expect } from "vitest";
import {
  DEFAULT_MOCKUP_HEIGHT,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
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

  it("stays legible when the stylesheet only references tokens it never defines", () => {
    // What actually happens: the agent lifts the repo's variable NAMES but the frame
    // is isolated, so every var() is invalid at computed-value time — background goes
    // transparent and color inherits to black. Over a dark dashboard that renders the
    // mockup invisible. An explicit ground and text colour make that impossible.
    const doc = mockupFrameSrcdoc(
      "<div>hi</div>",
      ".card { color: var(--nope); }",
    );

    expect(doc).toContain("background: #ffffff");
    expect(doc).toContain("color: #111111");
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

describe("sanitizeMockupMarkup", () => {
  // DOMPurify's default export is an INSTANCE in a browser and a FACTORY in Node,
  // where there is no window to purify against. A "use client" component still
  // renders on the server, so calling .sanitize during render crashed the whole
  // feature page with "sanitize is not a function" the moment a plan had a mockup.
  const instance = {
    sanitize: (raw: string) => raw.replace(/<script>.*?<\/script>/g, ""),
  };

  it("sanitizes with a purifier that has been given a window", () => {
    expect(
      sanitizeMockupMarkup(instance, "<p>hi</p><script>evil()</script>", {}),
    ).toBe("<p>hi</p>");
  });

  it("yields nothing rather than throwing where there is no window", () => {
    // The factory shape: callable, but no `sanitize` on it. Returning empty leaves
    // the frame blank for one server render; the client fills it after mount.
    const factory = (() => instance) as unknown as { sanitize?: unknown };

    expect(sanitizeMockupMarkup(factory, "<p>hi</p>", {})).toBe("");
  });
});
