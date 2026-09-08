import type { CSSProperties } from "react";

interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}

/** Size is per-instance data handed to the stylesheet as custom properties; spacing stays the caller's layout decision, via their own class. */
export default function Skeleton({
  width = "100%",
  height = 14,
  className,
}: SkeletonProps) {
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
