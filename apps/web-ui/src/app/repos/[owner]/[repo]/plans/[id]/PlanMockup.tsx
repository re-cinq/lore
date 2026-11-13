"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import {
  MOCKUP_HTML_CONFIG,
  MOCKUP_SVG_CONFIG,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
} from "@/lib/mockup-frame";
import { documentTokens, mermaidThemeOf } from "@/lib/mermaid-theme";
import type { Mockup } from "@re-cinq/planning-editor";
import MermaidCanvas from "./MermaidCanvas";
import styles from "./PlanMockup.module.scss";

interface SketchProps {
  markup: string;
  title: string;
  height: number;
}

export default function PlanMockup(props: Mockup) {
  const sketch = {
    markup: props.markup,
    title: props.caption || "Sketch",
    height: props.height,
  };
  const Sketch = SKETCHES[props.format] ?? TextSketch;

  return <Sketch {...sketch} />;
}

function HtmlSketch({ markup, title, height }: SketchProps) {
  const clean = useIsBrowser()
    ? sanitizeMockupMarkup(DOMPurify, markup, MOCKUP_HTML_CONFIG)
    : "";

  return (
    <SketchFrame markup={clean} title={title} height={mockupHeight(height)} />
  );
}

function SvgSketch({ markup }: SketchProps) {
  const clean = useIsBrowser()
    ? sanitizeMockupMarkup(DOMPurify, markup, MOCKUP_SVG_CONFIG)
    : "";

  return (
    <div className={styles.svg} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}

function TextSketch({ markup }: SketchProps) {
  return <pre className={styles.text}>{markup}</pre>;
}

function MermaidSketch({ markup, title }: SketchProps) {
  const drawn = useMermaidSvg(markup, useDocumentScheme());

  if (drawn === undefined) {
    return <p className={styles.note}>Drawing the sketch…</p>;
  }

  if (drawn === null) {
    return <UndrawnSketch markup={markup} />;
  }

  return <MermaidCanvas svg={drawn} title={title} />;
}

function UndrawnSketch({ markup }: { markup: string }) {
  return (
    <div className={styles.note}>
      <p>This sketch could not be drawn.</p>
      <details>
        <summary>Source</summary>
        <pre className={styles.text}>{markup}</pre>
      </details>
    </div>
  );
}

const SKETCHES: Record<string, (props: SketchProps) => React.ReactNode> = {
  html: HtmlSketch,
  svg: SvgSketch,
  mermaid: MermaidSketch,
  text: TextSketch,
};

type Scheme = "light" | "dark";

interface MermaidOutcome {
  source: string;
  scheme: Scheme;
  svg: string | null;
}

/** undefined while drawing, null when the diagram could not be drawn; an outcome for older markup or another scheme is never shown. */
function useMermaidSvg(
  markup: string,
  scheme: Scheme,
): string | null | undefined {
  const diagramId = `sketch-${useId().replace(/[^\w-]/g, "")}`;
  const [outcome, setOutcome] = useState<MermaidOutcome>();

  useEffect(() => {
    const request = { live: true };

    void renderMermaid(diagramId, markup, scheme).then((svg) => {
      if (request.live) {
        setOutcome({ source: markup, scheme, svg });
      }
    });

    return () => {
      request.live = false;
    };
  }, [diagramId, markup, scheme]);

  const current = outcome?.source === markup && outcome.scheme === scheme;

  return current ? outcome.svg : undefined;
}

let mermaidModule: Promise<typeof import("mermaid")> | undefined;

const FULL_WIDTH = { useMaxWidth: false };

// Mermaid's svg is put on the page unpurified, since purifying strips its labels; strict mode escapes the labels, and output that still carries a script, a handler or a javascript: link is dropped.
const UNSAFE_SVG = /<script|\son[a-z]+\s*=|javascript:/i;

async function renderMermaid(
  id: string,
  markup: string,
  scheme: Scheme,
): Promise<string | null> {
  mermaidModule ??= import("mermaid");
  const mermaid = (await mermaidModule).default;

  mermaid.initialize(mermaidConfigFor(scheme));
  const rendered = await mermaid.render(id, markup.trim()).catch(() => null);

  return rendered && !UNSAFE_SVG.test(rendered.svg) ? rendered.svg : null;
}

function mermaidConfigFor(scheme: Scheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    flowchart: { htmlLabels: false, ...FULL_WIDTH },
    sequence: FULL_WIDTH,
    er: FULL_WIDTH,
    state: FULL_WIDTH,
    class: FULL_WIDTH,
    ...mermaidThemeOf(documentTokens(), scheme),
  };
}

const SCHEME_ATTRIBUTE = "data-color-scheme";

/** The scheme the theme switcher set on the document, followed as it changes. */
function useDocumentScheme(): Scheme {
  return useSyncExternalStore(
    subscribeScheme,
    () =>
      document.documentElement.getAttribute(SCHEME_ATTRIBUTE) === "dark"
        ? "dark"
        : "light",
    () => "light",
  );
}

function subscribeScheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [SCHEME_ATTRIBUTE],
  });

  return () => observer.disconnect();
}

const subscribeNever = () => () => {};

function useIsBrowser(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function SketchFrame({ markup, title, height }: SketchProps) {
  return (
    <iframe
      className={styles.frame}
      sandbox=""
      srcDoc={mockupFrameSrcdoc(markup)}
      title={title}
      height={height}
    />
  );
}
