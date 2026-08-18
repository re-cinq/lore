// @vitest-environment jsdom
//
// jsdom on purpose: the sanitizer-config tests need DOMPurify's browser shape
// (an instance, not the windowless factory the component code has to absorb).
import { describe, it, expect } from "vitest";
import DOMPurify from "dompurify";
import {
  DEFAULT_MOCKUP_HEIGHT,
  MOCKUP_SVG_CONFIG,
  mermaidFrameHeight,
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

describe("a stylesheet that tries to close its own style block", () => {
  it("neutralises </style> so agent CSS cannot escape into markup", () => {
    // The stylesheet is LLM-authored and goes into `<style>…</style>` verbatim. A
    // literal `</style>` inside it ends the block early and everything after it is
    // parsed as HTML — inside a sandboxed frame, but still not what the author of
    // the plan asked for, and a way to smuggle markup past the mockup sanitizer.
    const doc = mockupFrameSrcdoc(
      "<p>x</p>",
      "a{}</style><img src=x onerror=1>",
    );

    expect(doc).not.toContain("</style><img");
    expect(doc.match(/<\/style>/g)).toHaveLength(1);
  });
});

describe("mermaidFrameHeight", () => {
  it("sizes the frame from the rendered svg's viewBox, with breathing room", () => {
    expect(
      mermaidFrameHeight('<svg viewBox="0 0 586 1477.5" class="flowchart">'),
    ).toBe(1494);
  });

  it("caps an absurdly tall diagram at the same ceiling a declared height gets", () => {
    expect(mermaidFrameHeight('<svg viewBox="0 0 100 99999">')).toBe(2000);
  });

  it("returns null for an svg that declares no viewBox — the default serves", () => {
    expect(mermaidFrameHeight("<svg><g/></svg>")).toBeNull();
  });
});

describe("the svg sanitizer config keeps mermaid's html labels", () => {
  // mermaid v11 emits ER labels and flowchart EDGE labels as foreignObject html
  // whatever flowchart.htmlLabels says. Forbidding the tag stripped every label
  // and an ER mockup rendered as an unlabeled skeleton — an empty-looking frame
  // (feature be6ad6a5, 2026-08-18). The sandboxed no-script frame is the boundary
  // that holds; the config only needs to keep executable content out.
  it("keeps the foreignObject element and never a script", () => {
    // jsdom parses the foreignObject interior stricter than a browser; in real
    // chromium this config keeps the label text too (verified against the
    // be6ad6a5 diagrams: 84/84 ER labels survive). What is assertable here:
    // the element is no longer stripped wholesale, and script never passes.
    const clean = DOMPurify.sanitize(
      '<svg viewBox="0 0 10 10"><foreignObject width="1" height="1">' +
        '<div xmlns="http://www.w3.org/1999/xhtml"><span>contains</span>' +
        "<script>evil()</scr" +
        "ipt></div></foreignObject></svg>",
      MOCKUP_SVG_CONFIG,
    );

    expect(clean).toContain("<foreignObject");
    expect(clean).not.toContain("script");
  });

  it("still strips event handlers and nested frames", () => {
    const clean = DOMPurify.sanitize(
      '<svg onload="evil()"><foreignObject><iframe src="x"></iframe>' +
        "</foreignObject></svg>",
      MOCKUP_SVG_CONFIG,
    );

    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("iframe");
  });
});
