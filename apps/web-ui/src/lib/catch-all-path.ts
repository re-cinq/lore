/** The file path a `[...path]` route was given: each segment is `encodeURIComponent`-encoded on the way in, so a path containing slashes survives the round trip. */
export function decodeCatchAllPath(segments: string[]): string {
  return segments.map(decodeURIComponent).join("/");
}
