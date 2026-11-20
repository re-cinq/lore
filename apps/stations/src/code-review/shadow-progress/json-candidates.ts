// An agent may write notes, with code fences of their own, before the fenced answer: every fence opening is tried up to the last closing one.
export function jsonCandidates(text: string): unknown[] {
  const close = text.lastIndexOf("```");
  const bodies = [...text.matchAll(/```(?:json)?[ \t]*\r?\n/g)]
    .map((open) => text.slice(open.index + open[0].length, close))
    .filter(Boolean);

  return [text, ...bodies].flatMap((body) => {
    try {
      return [JSON.parse(body) as unknown];
    } catch {
      return [];
    }
  });
}
