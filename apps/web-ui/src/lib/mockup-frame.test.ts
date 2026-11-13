// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import DOMPurify from "dompurify";
import {
  DEFAULT_MOCKUP_HEIGHT,
  MOCKUP_HTML_CONFIG,
  MOCKUP_SVG_CONFIG,
  mermaidFrameHeight,
  mermaidSize,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
} from "./mockup-frame";

const SKETCH_STYLE =
  ".sketch .section { border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; background: #ffffff; }";
const SKETCH_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M2 8h12"></path></svg>';
const UI_SKETCH = `<div class="sketch"><style>${SKETCH_STYLE}</style><div class="section"><h3>Prototype</h3><button>${SKETCH_ICON}Generate prototype</button><p class="hint">The agent draws diagrams and screen sketches from this plan.</p></div></div>`;

describe("mockupFrameSrcdoc", () => {
  it("renders the markup verbatim after the reset", () => {
    const doc = mockupFrameSrcdoc("<div class='card'>hi</div>");

    expect(doc.indexOf("box-sizing")).toBeLessThan(
      doc.indexOf("<div class='card'>hi</div>"),
    );
  });

  it("borrows none of the dashboard's own theme tokens", () => {
    expect(mockupFrameSrcdoc("<div>hi</div>")).not.toContain("var(--");
  });

  it("keeps a diagram inside the frame's width", () => {
    expect(mockupFrameSrcdoc("<svg/>")).toContain("max-width: 100%");
  });

  it("paints a white ground with dark text", () => {
    expect(mockupFrameSrcdoc("<div>hi</div>")).toMatch(
      /background: #ffffff; color: #111111;/,
    );
  });
});

describe("mockupHeight", () => {
  it("uses a declared height of 180", () => {
    expect(mockupHeight(180)).toBe(180);
  });

  it("falls back to the default for a height of 0", () => {
    expect(mockupHeight(0)).toBe(DEFAULT_MOCKUP_HEIGHT);
  });

  it("raises a height of 20 to the floor of 80", () => {
    expect(mockupHeight(20)).toBe(80);
  });

  it("caps a height of 99999 at 2000", () => {
    expect(mockupHeight(99999)).toBe(2000);
  });
});

describe("sanitizeMockupMarkup", () => {
  const instance = {
    sanitize: (raw: string) => raw.replace(/<script>.*?<\/script>/g, ""),
  };

  it("sanitizes with a purifier that has been given a window", () => {
    expect(
      sanitizeMockupMarkup(instance, "<p>hi</p><script>evil()</script>", {}),
    ).toBe("<p>hi</p>");
  });

  it("yields nothing where the purifier has no window", () => {
    expect(sanitizeMockupMarkup({}, "<p>hi</p>", {})).toBe("");
  });
});

describe("mermaidFrameHeight", () => {
  it("sizes a 1477.5 high viewBox to 1494", () => {
    expect(
      mermaidFrameHeight('<svg viewBox="0 0 586 1477.5" class="flowchart">'),
    ).toBe(1494);
  });

  it("caps a 99999 high diagram at 2000", () => {
    expect(mermaidFrameHeight('<svg viewBox="0 0 100 99999">')).toBe(2000);
  });

  it("returns null for an svg with no viewBox", () => {
    expect(mermaidFrameHeight("<svg><g/></svg>")).toBeNull();
  });
});

describe("mermaidSize", () => {
  it("reads 2400 by 300.5 from the viewBox", () => {
    expect(mermaidSize('<svg viewBox="-8 -8 2400 300.5">')).toEqual({
      width: 2400,
      height: 300.5,
    });
  });

  it("reads no size from an svg with no viewBox", () => {
    expect(mermaidSize("<svg><g/></svg>")).toBeNull();
  });
});

describe("MOCKUP_SVG_CONFIG", () => {
  it("strips foreignObject, onload and a nested iframe but keeps the text", () => {
    const clean = DOMPurify.sanitize(
      '<svg onload="evil()"><foreignObject><iframe src="x"></iframe>' +
        "</foreignObject><text>KEPT</text></svg>",
      MOCKUP_SVG_CONFIG,
    );

    expect(clean).toBe("<svg><text>KEPT</text></svg>");
  });
});

describe("MOCKUP_HTML_CONFIG", () => {
  it("keeps the worked example's style element and svg icon unchanged", () => {
    expect(DOMPurify.sanitize(UI_SKETCH, MOCKUP_HTML_CONFIG)).toBe(UI_SKETCH);
  });

  it("drops script, event handlers, frames, links and javascript urls from a sketch", () => {
    const hostile =
      '<div class="sketch"><style>.a{}</style>' +
      "<script>document.title='pwned'</script>" +
      '<button onclick="evil()" onpointerdown="evil()">Go</button>' +
      '<a href="javascript:evil()">link</a>' +
      '<iframe src="x"></iframe><object data="x"></object><embed src="x">' +
      '<link rel="stylesheet" href="x"><base href="x"></div>';

    expect(DOMPurify.sanitize(hostile, MOCKUP_HTML_CONFIG)).toBe(
      '<div class="sketch"><style>.a{}</style><button>Go</button><a>link</a></div>',
    );
  });
});

describe("MOCKUP_SVG_CONFIG and styles", () => {
  it("drops a style element from an svg sketch, which is drawn in the page itself", () => {
    const clean = DOMPurify.sanitize(
      "<svg><style>body{display:none}</style><text>KEPT</text></svg>",
      MOCKUP_SVG_CONFIG,
    );

    expect(clean).toBe("<svg><text>KEPT</text></svg>");
  });
});
