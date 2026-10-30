import type {
  DecompositionResult,
  StatementAssessment,
} from "../../domain/feature-planning/decomposition-result.js";
import { taskErrors, type VerifyEvidence } from "./implementation-tasks.js";
import {
  specParts,
  type SpecPart,
} from "../../domain/feature-planning/issue-coverage.js";
import { evidenceIsPresent } from "../../domain/feature-planning/grounding.js";
import {
  testLinksOfDoc,
  type DocTestLink,
} from "../../domain/spec-link-parser.js";

export interface ImplementationAssessmentInput {
  spec: string;
  specPath: string;
  commit: string;
  read(path: string): Promise<string | null>;
  parts?: readonly SpecPart[];
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

export async function assessImplementation(
  decomposition: DecompositionResult,
  input: ImplementationAssessmentInput,
): Promise<ImplementationAssessment> {
  const read = cachedRead(input.read);
  const verify: VerifyEvidence = async (evidence) =>
    evidenceIsPresent(evidence, await read(evidence.path));
  const checked = await checkStatements(decomposition, input, verify);
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
): Promise<CheckedStatement[]> {
  return Promise.all(
    (input.parts ?? specParts(input.spec)).map(({ line }) =>
      checkStatement(decomposition, { ...input, line }, verify),
    ),
  );
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
): Promise<CheckedStatement> {
  const claims = assessmentsForLine(decomposition, input);
  const claim = claims.at(0);
  const statement = missingStatement(input.specPath, input.line);

  if (!claim || claim.status === "missing") {
    return { statement, objections: [] };
  }
  const validProof = await verifyClaim(claim, verify);
  const validRevision =
    claims.length === 1 && decomposition.spec_commit === input.commit;

  return validProof && validRevision
    ? { statement: claim, objections: [] }
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

function rejectedStatement(statement: StatementAssessment): CheckedStatement {
  return {
    statement,
    objections: [
      `${statement.file} line ${statement.line}: evidence rejected; treat as missing and restore the full task scope, changes, acceptance criteria and test plan.`,
    ],
  };
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

      return `${link.path}${link.line ? `#L${link.line}` : ""}: ${status} at ${input.commit}`;
    }),
  );
}

function linkedTestExists(content: string | null, link: DocTestLink): boolean {
  if (content === null) {
    return false;
  }
  const lines = content.replace(/\n$/, "").split("\n");

  return link.line === null || (link.line > 0 && link.line <= lines.length);
}
