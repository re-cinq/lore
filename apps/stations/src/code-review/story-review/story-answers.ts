// What the three agents of the one-story review answer, as the stations read it.
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import { z } from "zod";
import { jsonCandidates } from "./json-candidates.js";

const status = z.enum(["complete", "incomplete"]);
const text = z.string().trim().min(1);
const place = z.object({ path: text, line: z.number().int().positive() });

export const told = z.object({
  status,
  story: z.array(
    z.object({ id: z.number().int(), behaviour: text, tests: z.array(place) }),
  ),
});

const gap = z.object({
  kind: z.enum([
    "contradiction",
    "missing_test",
    "missing_implementation",
    "untold",
  ]),
  subject: text,
  detail: text,
  location: place
    .extend({ side: z.enum(["LEFT", "RIGHT"]).optional() })
    .optional(),
  proposal: text.optional(),
  replaces_line: z.boolean().optional(),
  evidence: z.array(text).default([]),
});

export const checked = z.object({
  status,
  summary: text,
  gaps: z.array(gap),
  closed: z.array(text).default([]),
});

export type Place = z.infer<typeof place>;
export type StoryLine = z.infer<typeof told>["story"][number];
export type Gap = z.infer<typeof gap>;
export type Check = z.infer<typeof checked>;

/** An agent's answer as its schema reads it; nothing when the output holds no such answer. */
export function answerOf<T>(
  schema: z.ZodType<T>,
  output: string | undefined,
): T | undefined {
  if (!output) {
    return;
  }
  const answer = resultTextFromOutput(output)
    .replace(/(?:^|\n)LORE_NODE_RESULT: [^\r\n]+\s*$/, "")
    .trim();

  return jsonCandidates(answer)
    .map((candidate) => schema.safeParse(candidate).data)
    .find((result) => result !== undefined);
}
