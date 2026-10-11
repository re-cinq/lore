/** The longest a pull request title may run: past this a list cuts it anyway. */
const TITLE_MAX = 70;

/** One line, no runs of whitespace, cut with an ellipsis past the cap. */
export function clampPrTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();

  return oneLine.length > TITLE_MAX
    ? `${oneLine.slice(0, TITLE_MAX - 1)}…`
    : oneLine;
}
