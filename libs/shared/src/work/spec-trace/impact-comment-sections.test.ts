import { describe, expect, it } from "vitest";
import { buildImpactComment } from "./impact-comment.js";
import type { ImpactStatement } from "./impact-statement.js";

const OPENING =
  "The exhaustion MUST be logged at warn with the session, the budget and the tool names it was asked for, and never with their inputs.";
const LINKS = "([validated by `logs @1e7912b3`](test/budget.test.ts#L36))";
const MOVED_LINKS =
  "([validated by `logs @1e7912b3`](test/budget.test.ts#L90))";
const LINKS_ONLY_NOTE =
  "only its test links changed — the statement text itself is unchanged";

function rewriteSection(statementText: string, rewrittenAs?: string): string[] {
  const statement: ImpactStatement = {
    specPath: "specs/widget/spec.md",
    specTitle: "Widget Spec",
    section: "Functional Requirements",
    statementText,
    statementAnchor: "specs/widget/spec.md",
    tests: [{ file: "test/budget.test.ts", name: "logs", line: 36 }],
    changedFile: "specs/widget/spec.md",
    evidence: "statement-edit",
    changeKind: "changed",
    rewrittenAs,
  };
  const comment = buildImpactComment({
    status: "ok",
    statements: [statement],
    orphaned: [],
    testSelectors: [],
  });

  return comment
    .split("\n")
    .filter((line) => /^(> |- |\+ |only its test links|```)/.test(line));
}

describe("the rewrite section of an impact comment", () => {
  it("shows a sentence deleted past character 120 in a diff", () => {
    expect(
      rewriteSection(
        `${OPENING} This line is diagnostic only. ${LINKS}`,
        `${OPENING} ${LINKS}`,
      ),
    ).toEqual([
      "```diff",
      "- …ed for, and never with their inputs. This line is diagnostic only.",
      "+ …ed for, and never with their inputs.",
      "```",
    ]);
  });

  it("shows 80% and 60% in a diff when a figure changes past character 120", () => {
    expect(
      rewriteSection(
        `${OPENING} It fires at 80%. ${LINKS}`,
        `${OPENING} It fires at 60%. ${LINKS}`,
      ),
    ).toEqual([
      "```diff",
      "- …ever with their inputs. It fires at 80%.",
      "+ …ever with their inputs. It fires at 60%.",
      "```",
    ]);
  });

  it("says only the links changed when an anchor moves on a statement past character 120", () => {
    expect(
      rewriteSection(`${OPENING} ${LINKS}`, `${OPENING} ${MOVED_LINKS}`),
    ).toEqual([LINKS_ONLY_NOTE, `> ${OPENING.slice(0, 119)}…`]);
  });

  it("says only the links changed when an anchor moves in a group a period follows", () => {
    expect(
      rewriteSection(
        `A MUST hold (#12) ${LINKS}.`,
        `A MUST hold (#12) ${MOVED_LINKS}.`,
      ),
    ).toEqual([LINKS_ONLY_NOTE, "> A MUST hold (#12)."]);
  });

  it("says only the links changed when an anchor moves in a long group a period follows", () => {
    expect(
      rewriteSection(
        `${OPENING} (#12) ${LINKS}.`,
        `${OPENING} (#12) ${MOVED_LINKS}.`,
      ),
    ).toEqual([LINKS_ONLY_NOTE, `> ${OPENING.slice(0, 119)}…`]);
  });

  it("says only the links changed when a citation joins a statement that closed on a period", () => {
    expect(
      rewriteSection("A MUST hold (#12).", `A MUST hold (#12) ${LINKS}.`),
    ).toEqual([LINKS_ONLY_NOTE, "> A MUST hold (#12)."]);
  });

  it("says only the links changed when a citation joins a statement whose period stands apart", () => {
    expect(
      rewriteSection("A MUST hold (#12) .", `A MUST hold (#12) ${LINKS} .`),
    ).toEqual([LINKS_ONLY_NOTE, "> A MUST hold (#12)."]);
  });

  it("shows a diff when an edit adds a closing period and a citation together", () => {
    expect(
      rewriteSection("A MUST hold (#12)", `A MUST hold (#12) ${LINKS}.`),
    ).toEqual([
      "```diff",
      "- A MUST hold (#12)",
      "+ A MUST hold (#12).",
      "```",
    ]);
  });

  it("leaves a pipe unescaped in a diff, where a backslash would show", () => {
    expect(rewriteSection("Accepts a|b here.", "Accepts a|c here.")).toEqual([
      "```diff",
      "- Accepts a|b here.",
      "+ Accepts a|c here.",
      "```",
    ]);
  });

  it("quotes a statement nothing replaced, cut at 119 characters and an ellipsis", () => {
    expect(rewriteSection(`${OPENING} ${LINKS}`)).toEqual([
      `> ${OPENING.slice(0, 119)}…`,
    ]);
  });
});
