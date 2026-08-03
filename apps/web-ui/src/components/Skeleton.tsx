import type { CSSProperties } from "react";

export default function Skeleton({
  width = "100%",
  height = 14,
  style,
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  style?: CSSProperties;
}) {
  return (
    <div className="skeleton" style={{ width, height, ...style }} aria-hidden />
  );
}
