const BEGIN_MARKER = "<!-- lore-help:begin -->";
const END_MARKER = "<!-- lore-help:end -->";

export function hasValidHelpBlock(text: string): boolean {
  const lines = text.split("\n");
  const beginAt = lines.indexOf(BEGIN_MARKER);
  const endAt = lines.indexOf(END_MARKER);
  const markersAreSingle =
    lines.lastIndexOf(BEGIN_MARKER) === beginAt &&
    lines.lastIndexOf(END_MARKER) === endAt;

  if (beginAt < 0 || endAt < beginAt || !markersAreSingle) {
    return false;
  }

  const block = lines.slice(beginAt, endAt);

  return (
    block.some((line) => line.startsWith("**Summary.**")) &&
    block.some((line) => line.startsWith("**Usage:**"))
  );
}
