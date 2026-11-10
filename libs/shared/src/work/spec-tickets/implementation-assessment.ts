import type {
  DecompositionResult,
  StatementAssessment,
} from "../../domain/feature-planning/decomposition-result.js";
import { taskErrors, type VerifyEvidence } from "./implementation-tasks.js";
import { withoutUnplannableLines } from "./plannable-lines.js";
import {
  specParts,
  type SpecPart,
} from "../../domain/feature-planning/issue-coverage.js";
import { evidenceIsPresent } from "../../domain/feature-planning/grounding.js";
import {
  testLinksOfDoc,
  type DocTestLink,
} from "../../domain/spec-link-parser.js";
import { resolveAnchorLine } from "../../domain/spec-trace/resolve-anchor-line.js";

export interface ImplementationAssessmentInput {
  spec: string;
  specPath: string;
  commit: string;
  read(path: string): Promise<string | null>;
  parts?: readonly SpecPart[];
  /** Lines the run's load step settled as present on their linked tests (specs/spec-tickets FR25). */
  settled?: readonly StatementAssessment[];
}

export interface ImplementationAssessment {
  decomposition: DecompositionResult;
  objections: string[];
  diagnostics: string[];
}

type CheckedStatement = {
  statement: StatementAssessment;
  objections: string[];
};

/** Each statement line's linked tests that exist at the commit, named as `path#Lnn`. */
type TestedLines = ReadonlyMap<number, string[]>;

/** The settled assessments whose evidence verifies, by line. */
type SettledLines = ReadonlyMap<number, StatementAssessment>;

/** What the verifier holds about each statement line before it reads a claim. */
interface LineFacts {
  tested: TestedLines;
  settled: SettledLines;
}

// Triage's explicit parts are taken as given; a spec's own lines first lose the statements that state no work (specs/spec-tickets FR24).
export function assessImplementation(
  decomposition: DecompositionResult,
  input: ImplementationAssessmentInput,
): Promise<ImplementationAssessment> {
  return assessPlannable(
    input.parts
      ? decomposition
      : withoutUnplannableLines(decomposition, input.spec, input.specPath),
    input,
  );
}

async function assessPlannable(
  decomposition: DecompositionResult,
  input: ImplementationAssessmentInput,
): Promise<ImplementationAssessment> {
  const read = cachedRead(input.read);
  const verify = evidenceVerifier(read);
  const facts = await lineFacts(input, read, verify);
  const checked = await checkStatements(decomposition, input, verify, facts);
  const statements = checked.map((entry) => entry.statement);
  const objections = await taskErrors(
    decomposition,
    statements,
    input.specPath,
    verify,
  );

  return {
    ...assessmentResult(decomposition, input.commit, checked, objections),
    diagnostics: await testDiagnostics(input, read),
  };
}

function assessmentResult(
  decomposition: DecompositionResult,
  commit: string,
  checked: CheckedStatement[],
  objections: string[],
) {
  const statements = checked.map((entry) => entry.statement);

  return {
    decomposition: { ...decomposition, spec_commit: commit, statements },
    objections: [
      ...commitObjection(decomposition, commit),
      ...checked.flatMap((entry) => entry.objections),
      ...objections,
    ],
  };
}

function checkStatements(
  decomposition: DecompositionResult,
  input: ImplementationAssessmentInput,
  verify: VerifyEvidence,
  facts: LineFacts,
): Promise<CheckedStatement[]> {
  return Promise.all(
    (input.parts ?? specParts(input.spec)).map(({ line }) =>
      checkStatement(decomposition, { ...input, line }, verify, facts),
    ),
  );
}

function evidenceVerifier(
  read: ImplementationAssessmentInput["read"],
): VerifyEvidence {
  return async (evidence) =>
    evidenceIsPresent(evidence, await read(evidence.path));
}

export function cachedRead(
  read: ImplementationAssessmentInput["read"],
): ImplementationAssessmentInput["read"] {
  const contents = new Map<string, Promise<string | null>>();

  return (path) => {
    const content = contents.get(path) ?? read(path);

    contents.set(path, content);

    return content;
  };
}

async function lineFacts(
  input: ImplementationAssessmentInput,
  read: ImplementationAssessmentInput["read"],
  verify: VerifyEvidence,
): Promise<LineFacts> {
  const [tested, settled] = await Promise.all([
    testedLines(input, read),
    settledLines(input, verify),
  ]);

  return { tested, settled };
}

// Triage's explicit parts are not the spec's statements, so nothing settles them (specs/spec-tickets FR20, FR25).
async function settledLines(
  input: ImplementationAssessmentInput,
  verify: VerifyEvidence,
): Promise<SettledLines> {
  const offered = (input.parts ? [] : (input.settled ?? [])).filter(
    (entry) => entry.file === input.specPath && entry.status === "present",
  );
  const valid = await Promise.all(
    offered.map((entry) => verifyClaim(entry, verify)),
  );

  return new Map(
    offered
      .filter((_, index) => valid[index])
      .map((entry) => [entry.line, entry]),
  );
}

function commitObjection(
  decomposition: DecompositionResult,
  commit: string,
): string[] {
  return decomposition.spec_commit === commit
    ? []
    : [
        `Read the spec and implementation at ${commit}; set spec_commit to ${commit}.`,
      ];
}

async function checkStatement(
  decomposition: DecompositionResult,
  input: ImplementationAssessmentInput & { line: number },
  verify: VerifyEvidence,
  facts: LineFacts,
): Promise<CheckedStatement> {
  const claims = assessmentsForLine(decomposition, input);
  const claim = claims.at(0);
  const statement = missingStatement(input.specPath, input.line);
  const settled = facts.settled.get(input.line);

  if (!claim || claim.status === "missing") {
    return unclaimed(statement, claim, settled, facts.tested.get(input.line));
  }
  const validProof = await verifyClaim(claim, verify);
  const validRevision =
    claims.length === 1 && decomposition.spec_commit === input.commit;

  return validProof && validRevision
    ? { statement: claim, objections: [] }
    : refusedClaim(statement, claim, settled);
}

// A settled line stays present unless a missing claim says why its tests do not show it (specs/spec-tickets FR25).
function unclaimed(
  statement: StatementAssessment,
  claim: StatementAssessment | undefined,
  settled: StatementAssessment | undefined,
  tests?: string[],
): CheckedStatement {
  return settled && claim?.reason === undefined
    ? { statement: settled, objections: [] }
    : missingClaim(statement, claim, tests);
}

// A present claim whose proof fails leaves a settled line settled; a partial one is refused as before (specs/spec-tickets FR25).
function refusedClaim(
  statement: StatementAssessment,
  claim: StatementAssessment,
  settled: StatementAssessment | undefined,
): CheckedStatement {
  return settled && claim.status === "present"
    ? { statement: settled, objections: [] }
    : rejectedStatement(statement);
}

function assessmentsForLine(
  decomposition: DecompositionResult,
  input: { specPath: string; line: number },
): StatementAssessment[] {
  return (decomposition.statements ?? []).filter(
    (entry) => entry.file === input.specPath && entry.line === input.line,
  );
}

function missingStatement(file: string, line: number): StatementAssessment {
  return { file, line, status: "missing", evidence: [] };
}

async function verifyClaim(
  claim: StatementAssessment,
  verify: VerifyEvidence,
): Promise<boolean> {
  const results = await Promise.all(claim.evidence.map(verify));

  return results.length > 0 && results.every(Boolean);
}

// A statement whose linked test exists is missing only with a reason; without one the agent looks again (specs/spec-tickets FR23).
function missingClaim(
  statement: StatementAssessment,
  claim: StatementAssessment | undefined,
  tests: string[] = [],
): CheckedStatement {
  const reason = claim?.reason;

  if (reason !== undefined) {
    return { statement: { ...statement, reason }, objections: [] };
  }
  const objections =
    tests.length > 0 ? [testedObjection(statement, tests)] : [];

  return { statement, objections };
}

function testedObjection(
  { file, line }: StatementAssessment,
  tests: string[],
): string {
  return `${file} line ${line}: missing or unassessed, but its linked test ${tests.join(", ")} exists at this commit; read the code that test exercises, then claim present or partial with evidence, or keep missing and set reason to why the test does not show the behaviour.`;
}

function rejectedStatement(statement: StatementAssessment): CheckedStatement {
  return {
    statement,
    objections: [
      `${statement.file} line ${statement.line}: evidence rejected; treat as missing and restore the full task scope, changes, acceptance criteria and test plan.`,
    ],
  };
}

// Explicit parts, as triage supplies, are not the spec's statements, so no link belongs to them (specs/spec-tickets FR20).
async function testedLines(
  input: ImplementationAssessmentInput,
  read: ImplementationAssessmentInput["read"],
): Promise<TestedLines> {
  if (input.parts) {
    return new Map();
  }
  const links = testLinksOfDoc(input.specPath, input.spec).filter(
    (link) => !link.misplaced,
  );
  const exists = await Promise.all(
    links.map(async (link) => linkedTestExists(await read(link.path), link)),
  );

  return byStatementLine(links.filter((link, index) => exists[index]));
}

function byStatementLine(links: DocTestLink[]): TestedLines {
  const tested = new Map<number, string[]>();

  for (const { statementLine, ...link } of links) {
    if (statementLine !== null) {
      tested.set(statementLine, [
        ...(tested.get(statementLine) ?? []),
        linkName(link),
      ]);
    }
  }

  return tested;
}

function linkName(link: Pick<DocTestLink, "path" | "line">): string {
  return `${link.path}${link.line ? `#L${link.line}` : ""}`;
}

function testDiagnostics(
  input: ImplementationAssessmentInput,
  read: ImplementationAssessmentInput["read"],
): Promise<string[]> {
  return Promise.all(
    testLinksOfDoc(input.specPath, input.spec).map(async (link) => {
      const content = await read(link.path);
      const status = linkedTestExists(content, link)
        ? "linked test exists"
        : "linked test missing or out of bounds";

      return `${linkName(link)}: ${status} at ${input.commit}`;
    }),
  );
}

// A hashed link follows its test to the line the hash sits on now, so a test moved above a shortened file still exists.
function linkedTestExists(content: string | null, link: DocTestLink): boolean {
  if (content === null) {
    return false;
  }
  const lines = content.replace(/\n$/, "").split("\n");
  const line = resolveAnchorLine(link, content);

  return line === null || (line > 0 && line <= lines.length);
}
