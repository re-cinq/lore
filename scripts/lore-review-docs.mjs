// What a pull request changes in its Markdown, as the documents check reads it: each statement it writes with the lines of the tests it links, and each statement it removes. Links alone are bookkeeping and no change.
import {
  linesWithHash,
  nearestLine,
} from "../libs/shared/dist/domain/anchor-hash.js";
import {
  checkableTestLinks,
  withoutTrailingLinkGroup,
} from "../libs/shared/dist/domain/spec-link-parser.js";
import { segmentStatements } from "../libs/shared/dist/domain/spec-segment.js";

// A linked test is shown from the line its link names: long enough for its assertions, whatever the language.
const TEST_LINES = 40;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
// A link that cites a line of a file, as every coverage link does, whatever its label.
const LINE_LINK = /\[[^\]]*\]\([^)\s]*#L\d+(?:-L?\d+)?\)/g;

/** More changed statements than one check is handed; the whole-diff reviewer takes the change. */
export class DocsLimit extends Error {}

function withoutLineLinks(text) {
  return text.replace(LINE_LINK, "[]()");
}

/** Whether every document differs from its earlier text only in its coverage links. */
export function onlyLinksChanged(documents) {
  return documents.every(
    ({ before, after }) =>
      before !== null &&
      after !== null &&
      withoutLineLinks(before) === withoutLineLinks(after),
  );
}

export async function docsEvidence(documents, read) {
  const changes = documents.map(changesOf);
  const statements = await Promise.all(
    changes
      .flatMap(({ written }) => written)
      .map(async ({ links, ...statement }) => ({
        ...statement,
        tests: await Promise.all(links.map((link) => linkedTest(link, read))),
      })),
  );

  const evidence = {
    mode: "docs",
    statements,
    removed: changes.flatMap(({ removed }) => removed),
  };

  if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_EVIDENCE_BYTES) {
    throw new DocsLimit("Changed Markdown exceeds the review evidence limit");
  }

  return evidence;
}

function changesOf({ path, before, after }) {
  const [was, is] = [before, after].map((text) =>
    segmentStatements(text ?? "").map((statement) => ({
      ...statement,
      said: withoutLineLinks(statement.text),
      shown: withoutTrailingLinkGroup(statement.text),
    })),
  );
  const saidIn = (statements) => new Set(statements.map(({ said }) => said));
  const [earlier, later] = [saidIn(was), saidIn(is)];

  return {
    written: is
      .filter(({ said }) => !earlier.has(said))
      .map(({ shown, text, line, enclosingHeading }) => ({
        path,
        line,
        heading: enclosingHeading,
        text: shown,
        links: checkableTestLinks(text, path),
      })),
    removed: was
      .filter(({ said }) => !later.has(said))
      .map(({ shown, enclosingHeading }) => ({
        path,
        heading: enclosingHeading,
        text: shown,
      })),
  };
}

async function linkedTest({ path, line, hash }, read) {
  const source = await read(path);

  if (source === null) {
    return { path, missing: true };
  }
  const cited = line ?? 1;
  const start = hash
    ? (nearestLine(linesWithHash(source, hash), cited) ?? cited)
    : cited;

  return {
    path,
    line: start,
    lines: source
      .split("\n")
      .slice(start - 1, start - 1 + TEST_LINES)
      .map((text, index) => `${start + index}| ${text}`),
  };
}
