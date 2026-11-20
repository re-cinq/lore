/** A packet as the file an agent reads: a text of several lines becomes a list of its numbered lines, because a reader opens a file a page of lines at a time and cannot open one long line. */
export function pagedPacket(packet: unknown): string {
  return JSON.stringify(
    packet,
    (_key, value: unknown) =>
      typeof value === "string" && value.includes("\n")
        ? value.split("\n").map((line, index) => `${index + 1}| ${line}`)
        : value,
    1,
  );
}
