// The rendered width of one element, followed as it resizes (run-viz FR4.1a): the graph wraps to it. Null until measured — on the server and in a browser without ResizeObserver — which the graph reads as "do not wrap".
import { useEffect, useRef, useState, type RefObject } from "react";

export function useElementWidth<T extends Element>(): [
  RefObject<T | null>,
  number | null,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
