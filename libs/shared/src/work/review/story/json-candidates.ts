// An agent may write notes, with code fences of their own, before its answer: every fence opening is tried up to the last closing one, and with no fenced answer every line that opens an object, up to the last closing brace.
export function jsonCandidates(text: string): unknown[] {
  const lastFence = text.lastIndexOf("```");
  const fenced = [...text.matchAll(/```(?:json)?[ \t]*\r?\n/g)].map((open) =>
    text.slice(open.index + open[0].length, lastFence),
  );
  const whole = parsed([text, ...fenced]);

  if (whole.length > 0) {
    return whole;
  }
  const lastBrace = text.lastIndexOf("}") + 1;

  return parsed(
    [...text.matchAll(/^[ \t]*\{/gm)].map((open) =>
      text.slice(open.index, lastBrace),
    ),
  );
}

function parsed(bodies: string[]): unknown[] {
  return bodies.filter(Boolean).flatMap((body) => {
    try {
      return [JSON.parse(body) as unknown];
    } catch {
      return [];
    }
  });
}
