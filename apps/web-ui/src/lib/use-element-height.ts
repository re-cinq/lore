import { useEffect, useRef, useState, type RefObject } from "react";

/** The height of the element `ref` is attached to, kept current as it resizes; 0 where nothing can observe it. */
export function useElementHeight<T extends Element>(): {
  ref: RefObject<T | null>;
  height: number;
} {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() =>
      setHeight(Math.round(element.getBoundingClientRect().height)),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
