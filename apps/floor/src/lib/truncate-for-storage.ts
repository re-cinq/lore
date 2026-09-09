/** Byte-cap text with marker showing original size (not chars; prevents false completeness). */
export function truncateForStorage(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return text;
  }

  return `${bytes.subarray(0, maxBytes).toString("utf8")}…[truncated, ${bytes.byteLength} bytes]`;
}
