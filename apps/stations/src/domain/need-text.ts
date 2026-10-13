/** The half of a station's tools a file need is read through. */
export interface NeedReader {
  read(need: string): Promise<Buffer>;
}

/** The text of a file need that may be absent: "" when the brief carries none. */
export async function optionalNeedText(
  needs: Readonly<Record<string, string>>,
  tools: NeedReader,
  need: string,
): Promise<string> {
  return need in needs ? (await tools.read(need)).toString("utf8").trim() : "";
}
