"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import type { GapMockup } from "@/lib/feature-types";
import {
  MOCKUP_HTML_CONFIG,
  MOCKUP_SVG_CONFIG,
  mermaidFrameHeight,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
} from "@/lib/mockup-frame";

// LLM-generated mockup markup is UNTRUSTED. Two boundaries, not one:
//
//  1. `sandbox=""` on the frame — no scripting, no same-origin, no parent access.
//     This is what lets a mockup carry the PLANNED repo's stylesheet at all; a
//     `<style>` inside an inline svg applies document-wide, so the old inline
//     rendering would have let a mockup restyle the wizard around it.
//  2. DOMPurify over the markup before it goes in, with the profile that matches
//     the format (MOCKUP_*_CONFIG in mockup-frame.ts, where the foreignObject
//     decision is documented) — the svg profile would strip an html mockup's
//     divs to nothing.
//
// sanitizeGapResult() runs on the write path too (defense in depth). NEVER put
// mockup markup anywhere but inside the frame.

const DOWNLOAD_EXTENSION: Record<string, string> = {
  svg: "svg",
  html: "html",
  mermaid: "mmd",
};

function downloadName(mockup: GapMockup, index: number): string {
  const stem = (mockup.title || `mockup-${index + 1}`).replace(
    /[^\w.-]+/g,
    "-",
  );

  return `${stem}.${DOWNLOAD_EXTENSION[mockup.format ?? "svg"] ?? "txt"}`;
}

/** Render mermaid SOURCE to an svg string, or null while loading / on a syntax
 *  error. mermaid is imported lazily: it is the heaviest thing on this page and
 *  most rounds carry no diagram at all. */
/** Never changes, so it never notifies — the store IS "am I in a browser". */
const subscribeNever = () => () => {};

function useMermaidSvg(mockup: GapMockup, index: number): string | null {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (mockup.format !== "mermaid") {
      return;
    }
    let live = true;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Plain <text> node labels where mermaid offers the choice — crisper in
          // the sandboxed frame and independent of html sanitization. This flag is
          // flowchart-only: ER labels and flowchart EDGE labels are foreignObject
          // html regardless, which is why MOCKUP_SVG_CONFIG must allow the tag.
          flowchart: { htmlLabels: false },
        });
        const rendered = await mermaid.render(
          `mockup-${index}`,
          mockup.markup.trim(),
        );

        if (live) {
          // Tripwire, not a sanitizer: strict-mode mermaid does not emit script
          // tags, so an output carrying one is treated as a failed render rather
          // than framed. The frame's sandbox would inert it anyway.
          setSvg(/<script/i.test(rendered.svg) ? "" : rendered.svg);
        }
      } catch {
        // A diagram that will not parse is not worth failing the round over — the
        // author still has every section, and the figure says what happened.
        if (live) {
          setSvg("");
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [mockup.format, mockup.markup, index]);

  return svg;
}

function MockupFigure({
  mockup,
  index,
  stylesheet,
}: {
  mockup: GapMockup;
  index: number;
  stylesheet?: string;
}) {
  const mermaidSvg = useMermaidSvg(mockup, index);
  const isMermaid = mockup.format === "mermaid";
  const isHtml = mockup.format === "html";
  // Sanitized only where there is a DOM. This component renders on the SERVER too —
  // "use client" means "also on the client" — and DOMPurify's default export is a
  // FACTORY there, with no `sanitize` on it, which took the whole feature page down
  // as soon as a plan carried a mockup. useSyncExternalStore rather than an effect:
  // the server and the client legitimately disagree here, and this is the hook that
  // says so without a setState or a hydration mismatch.
  const isBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  // A mermaid-RENDERED svg is framed WITHOUT a DOMPurify pass: DOMPurify's mXSS
  // defense strips foreignObject INTERIORS under every configuration (verified
  // against 3.4.11 — plain, xhtml parser mode, extra ADD_TAGS), and mermaid v11
  // puts ER labels and flowchart edge labels there, so purifying the output
  // guarantees an unlabeled skeleton. Its two boundaries are mermaid's own
  // securityLevel:"strict" render (which sanitizes label text) and the
  // no-script sandboxed frame; useMermaidSvg additionally refuses an output
  // carrying a script tag. Author-supplied raw svg/html markup — which mermaid
  // never vetted — still goes through DOMPurify.
  const clean = isMermaid
    ? isBrowser
      ? (mermaidSvg ?? "")
      : ""
    : isBrowser
      ? sanitizeMockupMarkup(
          DOMPurify,
          mockup.markup,
          isHtml ? MOCKUP_HTML_CONFIG : MOCKUP_SVG_CONFIG,
        )
      : "";
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(mockup.markup)}`;

  return (
    <figure style={{ margin: "0 0 12px" }}>
      <figcaption
        className="meta"
        style={{
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{mockup.title || `Mockup ${index + 1}`}</span>
        <a href={href} download={downloadName(mockup, index)} className="meta">
          download ↓
        </a>
      </figcaption>
      {isMermaid && mermaidSvg === null ? (
        <div className="meta">rendering diagram…</div>
      ) : (
        <iframe
          // No allow-scripts and no allow-same-origin: the frame can paint and
          // nothing else. It therefore cannot measure itself, which is why an html
          // mockup declares the height it needs.
          sandbox=""
          srcDoc={mockupFrameSrcdoc(clean, stylesheet)}
          title={mockup.title || `Mockup ${index + 1}`}
          // A rendered mermaid diagram knows its real height (the frame cannot
          // measure itself); a declared/default height serves the rest.
          height={
            (isMermaid && mermaidSvg ? mermaidFrameHeight(mermaidSvg) : null) ??
            mockupHeight(mockup)
          }
          style={{
            width: "100%",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "block",
          }}
        />
      )}
    </figure>
  );
}

export default function MockupSection({
  mockups,
  stylesheet,
}: {
  mockups: GapMockup[];
  stylesheet?: string;
}) {
  return (
    <div>
      {mockups.map((m, i) => (
        <MockupFigure key={i} mockup={m} index={i} stylesheet={stylesheet} />
      ))}
    </div>
  );
}
