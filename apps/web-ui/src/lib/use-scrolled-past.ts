import { useEffect, useRef, useState, type RefObject } from "react";

/** Whether the page has scrolled past a zero-height sentinel; attach `sentinelRef` just above the element that reacts. */
export function useScrolledPast<T extends Element>(): {
  sentinelRef: RefObject<T | null>;
  scrolled: boolean;
} {
  const sentinelRef = useRef<T | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setScrolled(!entry.isIntersecting),
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  return { sentinelRef, scrolled };
}
