/** Decode the raw text a planning model returns into JSON (often ```json fenced); a malformed payload fails loud with the offending snippet, not a bare SyntaxError. */

const SNIPPET_MAX = 200;

/** Strip an optional ```json … ``` (or bare ``` … ```) fence the model may wrap the JSON in. */
export function stripFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);

  return (fenced ? fenced[1] : text).trim();
}

/** Parse fenced-or-bare model output as JSON, throwing a snippet-carrying error on failure. */
export function parseModelJson(text: string): unknown {
  const body = stripFence(text);

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `feature-planning: model returned non-JSON — ${body.slice(0, SNIPPET_MAX)}`,
    );
  }
}
