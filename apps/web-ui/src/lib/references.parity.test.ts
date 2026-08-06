import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so the reference scanner is hand-duplicated. This CI-only test
// (runs in a full checkout) imports shared's PURE references.ts by file path —
// never the package — to keep the mirror in lockstep. The mirror always links
// task UUIDs to the relative internal /assembly-lines page; canonical does the
// same when `uiUrl: "/"` is passed (the trailing slash is stripped), so deep
// equality against that context pins every scanner behaviour at once.
import { parseReferences as mirror } from "./references";
import { parseReferences as canonical } from "../../../../libs/shared/src/references";

const ctx = { repo: "re-cinq/lore", branch: "dev" };
const uuid = "fb964a3c-2c4c-4de6-b76c-cebe715b51a9";

const FIXTURES = [
  "edit src/a.ts and ./scripts/run.sh please",
  "see #424 and #7",
  `task ${uuid} finished`,
  "plain prose, nothing to link",
  "v1.2.3 is not a file",
  "inside `code src/a.ts #42` nothing links",
  "an existing [link](src/a.ts) stays untouched",
  "a [link](specs/a_(draft)/spec.md) with target parens stays whole",
  "a bare https://github.com/re-cinq/lore/blob/main/src/a.ts survives",
  `mixed: src/a.ts, #12, ${uuid}, \`x/y.md\`, [t](z.md), end`,
];

describe("references parity (web-ui mirror vs shared canonical)", () => {
  it.each(FIXTURES)("segments %j identically under uiUrl '/'", (text) => {
    expect(mirror(text, ctx)).toEqual(canonical(text, { ...ctx, uiUrl: "/" }));
  });

  it("documents the intentional delta: mirror always links uuids, canonical without uiUrl does not", () => {
    expect(mirror(uuid, ctx)).toEqual([
      { text: uuid, href: `/assembly-lines/${uuid}` },
    ]);
    expect(canonical(uuid, ctx)).toEqual([{ text: uuid }]);
  });
});
