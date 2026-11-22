// The two ways the implementation loop sends a ticket's acceptance tests back to the definition of done (specs/external-floor FR12.24, FR12.25): CI shows one that cannot even run, or a round names one it could not pass and touched no acceptance test. Missing code is the red a round owes, so an import of a module the ticket adds is not a broken test.

const ACCEPTANCE_FILE =
  /\.acceptance\.test\.[cm]?[jt]sx?\b|_?acceptance_test\.go\b/;

const CANNOT_RUN =
  /\byaml: |\bjson: |SyntaxError|Transform failed|Unexpected token|ParseError|invalid character .* looking for/;

export interface TestWrongReport {
  file: string;
  test: string;
  reason: string;
}

export type TestWrongVerdict =
  { accepted: true; feedback: string } | { accepted: false; reason: string };

export interface TestWrongEvidence {
  /** The named file at the branch head; null when the branch has no such file. */
  source: string | null;
  /** The files the round's newest commit touched. */
  roundFiles: readonly string[];
}

export function isAcceptanceTestFile(path: string): boolean {
  return ACCEPTANCE_FILE.test(path);
}

/** The CI line, and the line after it when the error is reported there, that shows an acceptance test which could not run; null when every failure is a test that ran and was red. */
export function brokenAcceptanceTest(summary: string): string | null {
  const lines = summary.split("\n");
  const at = lines.findIndex(
    (line, index) =>
      ACCEPTANCE_FILE.test(line) &&
      (CANNOT_RUN.test(line) || CANNOT_RUN.test(lines[index + 1] ?? "")),
  );

  if (at < 0) {
    return null;
  }

  return CANNOT_RUN.test(lines[at])
    ? lines[at]
    : `${lines[at]}\n${lines[at + 1]}`;
}

/** The `tdd_test_wrong` a round reports, when it names an acceptance test file, a test and a reason. */
export function parseTestWrongReport(raw: string): TestWrongReport | null {
  const report = jsonObjectOf(raw);
  const [file, test, reason] = ["file", "test", "reason"].map((key) =>
    typeof report?.[key] === "string" ? report[key].trim() : "",
  );

  const named = [file, test, reason].every(Boolean);

  return named && isAcceptanceTestFile(file) ? { file, test, reason } : null;
}

function jsonObjectOf(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Accepts a round's report only when the branch holds the named test and the round's newest commit did not change that file; anything else is a failed round. */
export function testWrongVerdict(
  report: TestWrongReport | null,
  { source, roundFiles }: TestWrongEvidence,
): TestWrongVerdict {
  if (!report) {
    return refused(
      "the round named no acceptance test as {file, test, reason} in tdd_test_wrong",
    );
  }

  if (source === null) {
    return refused(`the branch has no ${report.file}`);
  }

  if (!source.includes(report.test)) {
    return refused(`${report.file} holds no test named "${report.test}"`);
  }

  return roundFiles.includes(report.file)
    ? refused(`the round changed the acceptance test ${report.file}`)
    : { accepted: true, feedback: feedbackOf(report) };
}

function refused(reason: string): TestWrongVerdict {
  return { accepted: false, reason };
}

function feedbackOf({ file, test, reason }: TestWrongReport): string {
  return `# An acceptance test the round could not pass

The round reported that this acceptance test is wrong, and did not change that file.

- File: \`${file}\`
- Test: ${test}
- Reason: ${reason}

Fix this test, or remove it, so it fails only for the claim the ticket makes.
`;
}

/** What the definition of done is handed when CI shows an acceptance test that could not run. */
export function brokenTestFeedbackOf(line: string): string {
  return `# An acceptance test that could not run

CI ran this branch's acceptance tests and one of them failed before it could test anything:

\`\`\`
${line}
\`\`\`

Fix the test so it runs and fails only for the claim the ticket makes.
`;
}
