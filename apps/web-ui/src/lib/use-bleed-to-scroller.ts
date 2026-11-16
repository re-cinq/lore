import { useEffect, type RefObject } from "react";

interface Edges {
  left: number;
  right: number;
}

interface ScrollerBox {
  left: number;
  clientLeft: number;
  clientWidth: number;
}

/** How far the scroller's visible width reaches past the bar on each side: its padding, without the scroll bar. */
export function bleedOf(element: Edges, scroller: ScrollerBox): Edges {
  const inner = scroller.left + scroller.clientLeft;

  return {
    left: element.left - inner,
    right: inner + scroller.clientWidth - element.right,
  };
}

/** Keeps `--bleed-left` and `--bleed-right` on the element current, so a layer of it can span its scroller's whole visible width; nothing where it cannot be observed. */
export function useBleedToScroller<T extends HTMLElement>(
  ref: RefObject<T | null>,
): void {
  useEffect(() => {
    const element = ref.current;
    const scroller = element ? scrollerOf(element) : null;

    if (!element || !scroller || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setBleed(element, scroller));

    observer.observe(element);
    observer.observe(scroller);

    return () => observer.disconnect();
  }, [ref]);
}

function scrollerOf(element: HTMLElement): HTMLElement | null {
  const parent = element.parentElement;

  if (!parent) {
    return null;
  }

  return /auto|scroll/.test(getComputedStyle(parent).overflowY)
    ? parent
    : scrollerOf(parent);
}

function setBleed(element: HTMLElement, scroller: HTMLElement): void {
  const { left, right } = bleedOf(element.getBoundingClientRect(), {
    left: scroller.getBoundingClientRect().left,
    clientLeft: scroller.clientLeft,
    clientWidth: scroller.clientWidth,
  });

  element.style.setProperty("--bleed-left", `${left}px`);
  element.style.setProperty("--bleed-right", `${right}px`);
}
