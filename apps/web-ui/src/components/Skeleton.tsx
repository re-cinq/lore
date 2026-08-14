import type { CSSProperties } from "react";

/**
 * A shimmering placeholder bar. Size is per-instance data, so it is handed to the
 * stylesheet as custom properties rather than as a style object; spacing is the
 * caller's layout decision and arrives as a class from their own module.
 */
export default function Skeleton({
  width = "100%",
  height = 14,
  className,
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}) {
  return (
    <div
      className={className ? `skeleton ${className}` : "skeleton"}
      style={{
        ["--skeleton-width" as string]:
          typeof width === "number" ? `${width}px` : width,
        ["--skeleton-height" as string]:
          typeof height === "number" ? `${height}px` : height,
      }}
      aria-hidden
    />
  );
}
