import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import type {
  ReviewOutput,
  ReviewFinding,
} from "@re-cinq/lore-shared/review/review-findings.js";
import { z } from "zod";

const status = z.enum(["complete", "incomplete"]);
const reading = z.object({
  status,
  reading: z.array(z.string().trim().min(1)).min(1),
  evidence: z.array(z.string().trim().min(1)),
  requests: z.array(z.string().trim().min(1)),
});
const finding = z.object({
  severity: z.enum(["blocking", "question", "note"]),
  location: z
    .object({
      path: z.string().trim().min(1),
      line: z.number().int().positive(),
      side: z.enum(["LEFT", "RIGHT"]).optional(),
    })
    .optional(),
  subject: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  evidence: z.array(z.string().trim().min(1)).min(1),
});
const intent = z.object({
  status,
  summary: z.string().trim().min(1),
  findings: z.array(finding),
});
const product = z.object({
  status,
  summary: z.string().trim().min(1),
  verdict: z.enum(["approve", "request_changes", "incomplete"]),
  findings: z.array(finding),
});

const passes = {
  code_reading: "Code reading",
  test_reading: "Test reading",
  intent_comparison: "Intent comparison",
  test_challenge: "Test challenge",
  product_review: "Product review",
} as const;

export const progressNeeds = [
  "code_reading",
  "test_reading",
  "intent_comparison",
  "test_challenge",
  "product_review",
] as const;
type PassName = (typeof progressNeeds)[number];
export type ProgressResults = Partial<Record<PassName, string>>;

export type ProgressState = "running" | "complete" | "failed";

type PassResult = {
  complete: boolean;
  lines: string[];
  proposesChanges?: boolean;
};

export function reviewProgress(
  outputs: ProgressResults,
  stage: number,
  lineId = "code-review-shadow",
): {
  incomplete: string[];
  body(revision: string, state: ProgressState): string;
} {
  const results = parseResults(outputs);
  const missing = progressNeeds
    .slice(0, stage + 1)
    .filter((name) => !results[name].complete);

  return {
    incomplete: missing.map((name) => passes[name]),
    body: (revision, state) =>
      renderReviewProgress({ revision, state, lineId }, results, missing),
  };
}

export function formalReview(
  outputs: ProgressResults,
): ReviewOutput | undefined {
  const complete =
    reviewProgress(outputs, progressNeeds.length - 1).incomplete.length === 0;
  const comparison = parse(intent, outputs.intent_comparison);
  const assessment = parse(product, outputs.product_review);

  if (!complete || !comparison || !assessment) {
    return;
  }

  const reported = [...assessment.findings, ...comparison.findings];
  const blocked =
    assessment.verdict === "request_changes" || reported.some(isBlocking);

  return {
    verdict: blocked ? "changes_requested" : "approved",
    summary: escapeMarkdown(assessment.summary),
    ...formalFindings(reported),
  };
}

type PassFinding = z.infer<typeof finding>;
const labels = {
  blocking: "issue",
  question: "question",
  note: "thought",
} as const;

function formalFindings(reported: PassFinding[]) {
  const distinct = new Map(
    reported.map((finding) => [JSON.stringify(finding), finding]),
  );
  const findings: ReviewFinding[] = [];
  const generalFindings: NonNullable<ReviewOutput["generalFindings"]> = [];

  for (const finding of distinct.values()) {
    const detail = findingDetail(finding);

    if (!finding.location) {
      generalFindings.push(detail);
      continue;
    }
    findings.push({ ...detail, ...finding.location });
  }

  return { findings, ...(generalFindings.length ? { generalFindings } : {}) };
}

function findingDetail(
  finding: PassFinding,
): Omit<ReviewFinding, "path" | "line"> {
  return {
    label: labels[finding.severity],
    decoration: isBlocking(finding) ? "blocking" : "non-blocking",
    subject: escapeMarkdown(finding.subject),
    discussion: [finding.detail, ...finding.evidence]
      .map(escapeMarkdown)
      .join("\n\n"),
  };
}

interface ProgressHeader {
  revision: string;
  state: ProgressState;
  lineId: string;
}

function renderReviewProgress(
  header: ProgressHeader,
  results: Record<PassName, PassResult>,
  incomplete: readonly PassName[],
): string {
  const verdict = proposedVerdict(header.state, results, incomplete);
  const details = progressNeeds.flatMap((name) =>
    renderSection(name, results[name]),
  );

  return [
    header.lineId === "code-review-shadow"
      ? "## Lore shadow review"
      : "## Lore code review",
    `Reviewed revision \`${header.revision}\` · **${verdict}**`,
    ...lineNote(header),
    ...details,
    ...missingSections(verdict, incomplete),
  ].join("\n\n");
}

function lineNote({ state, lineId }: ProgressHeader): string[] {
  if (lineId === "code-review-shadow") {
    return ["The current review and its check carry the merge decision."];
  }

  return state === "failed"
    ? ["Lore reviews this revision from its whole diff instead."]
    : [];
}

function parseResults(outputs: ProgressResults): Record<PassName, PassResult> {
  return {
    code_reading: readPass(outputs.code_reading, 2),
    test_reading: readPass(outputs.test_reading),
    intent_comparison: intentPass(outputs.intent_comparison),
    test_challenge: readPass(outputs.test_challenge),
    product_review: productPass(outputs.product_review),
  };
}

function proposedVerdict(
  state: ProgressState,
  results: Record<PassName, PassResult>,
  incomplete: readonly PassName[],
): string {
  if (state === "running") {
    return "In progress";
  }

  if (state === "failed" || incomplete.length > 0) {
    return "Incomplete";
  }

  if (Object.values(results).some((result) => result.proposesChanges)) {
    return "Proposed changes requested";
  }

  return "Proposed approval";
}

function renderSection(name: PassName, result: PassResult): string[] {
  const lines = result.lines.filter(Boolean);
  const section = lines.join("\n\n");

  return section ? [`### ${passes[name]}\n\n${section.slice(0, 9_000)}`] : [];
}

function missingSections(
  verdict: string,
  incomplete: readonly PassName[],
): string[] {
  return verdict === "Incomplete" && incomplete.length
    ? [
        `Incomplete passes — ${incomplete.map((name) => passes[name]).join(", ")}`,
      ]
    : [];
}

function readPass(
  output: string | undefined,
  sentenceCount?: number,
): PassResult {
  const result = parse(reading, output);

  return {
    complete:
      result?.status === "complete" &&
      (sentenceCount === undefined || result.reading.length === sentenceCount),
    lines: readingLines(result),
  };
}

function intentPass(output: string | undefined): PassResult {
  const result = parse(intent, output);

  return {
    complete: result?.status === "complete",
    proposesChanges: result?.findings.some(isBlocking),
    lines: result
      ? [escapeMarkdown(result.summary), ...findingBullets(result.findings)]
      : [],
  };
}

function productPass(output: string | undefined): PassResult {
  const result = parse(product, output);

  return {
    complete: result?.status === "complete" && result.verdict !== "incomplete",
    proposesChanges:
      result?.verdict === "request_changes" ||
      result?.findings.some(isBlocking),
    lines: productLines(result),
  };
}

function productLines(result: z.infer<typeof product> | undefined): string[] {
  if (!result) {
    return [];
  }

  return [escapeMarkdown(result.summary), ...findingBullets(result.findings)];
}

function isBlocking({ severity }: z.infer<typeof finding>): boolean {
  return severity === "blocking";
}

function parse<T>(
  schema: z.ZodType<T>,
  output: string | undefined,
): T | undefined {
  if (!output) {
    return;
  }
  const text = resultTextFromOutput(output)
    .replace(/(?:^|\n)LORE_NODE_RESULT: [^\r\n]+\s*$/, "")
    .trim();
  const fenced =
    /^(?:[^`]*?\r?\n)?```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(text);

  try {
    return schema.safeParse(JSON.parse(fenced?.[1] ?? text)).data;
  } catch {
    return;
  }
}

function findingBullets(
  findings: readonly z.infer<typeof finding>[],
): string[] {
  return bullets(
    findings.map(({ severity, subject, detail, evidence }) =>
      [`${severity} · ${subject} — ${detail}`, ...evidence].join(" "),
    ),
  );
}

function readingLines(result: z.infer<typeof reading> | undefined): string[] {
  if (!result) {
    return [];
  }

  return [
    escapeMarkdown(result.reading.join(" ")),
    ...bullets(result.evidence),
    ...bullets(
      result.requests.map((request) => `Needed evidence — ${request}`),
    ),
  ];
}

function bullets(values: readonly string[]): string[] {
  return values.map((value) => `- ${escapeMarkdown(value)}`);
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replace(/[\\`*_[\]~]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}
