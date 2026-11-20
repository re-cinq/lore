// What the three agents of the one-story review answer, as the stations read it.
import { z } from "zod";
import { jsonCandidates } from "./json-candidates.js";

const status = z.enum(["complete", "incomplete"]);
const text = z.string().trim().min(1);
const place = z.object({ path: text, line: z.number().int().positive() });

// A model sometimes gives a reference as an object of path, line and note; its values, in order, say the same.
const reference = z.union([
  text,
  z
    .record(z.string(), z.union([z.string(), z.number()]))
    .transform((parts) => Object.values(parts).join(" ")),
]);

export const told = z.object({
  status,
  summary: text.optional(),
  story: z.array(
    z.object({
      text,
      list: z.array(text).default([]),
      tests: z.array(place).default([]),
    }),
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
  evidence: z.array(reference).default([]),
});

export const checked = z.object({
  status,
  summary: text,
  gaps: z.array(gap),
  closed: z.array(text).default([]),
  declined: z.array(z.object({ subject: text, reply: z.url() })).default([]),
});

export type Place = z.infer<typeof place>;
export type StoryPart = z.infer<typeof told>["story"][number];
export type Gap = z.infer<typeof gap>;
export type Check = z.infer<typeof checked>;
export type Declined = Check["declined"][number];

/** An agent's answer text as its schema reads it; nothing when the text holds no such answer. */
export function answerOf<T>(
  schema: z.ZodType<T>,
  text: string | undefined,
): T | undefined {
  if (!text) {
    return;
  }
  const answer = text
    .replace(/(?:^|\n)LORE_NODE_RESULT: [^\r\n]+\s*$/, "")
    .trim();

  return jsonCandidates(answer)
    .map((candidate) => schema.safeParse(candidate).data)
    .find((result) => result !== undefined);
}
