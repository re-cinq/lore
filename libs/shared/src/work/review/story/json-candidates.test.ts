import { expect, it } from "vitest";
import { jsonCandidates } from "./json-candidates.js";

it("finds the JSON answer after notes that quote `code` and carry a fenced example of their own", () => {
  const answer = [
    "**Alignment:** `claimAnnouncement` returns true once.",
    "```ts\nclaimAnnouncement(repo, version);\n```",
    "---",
    '```json\n{ "status": "complete" }\n```',
  ].join("\n\n");

  expect(jsonCandidates(answer)).toEqual([{ status: "complete" }]);
});

it("reads a bare JSON answer with no fence", () => {
  expect(jsonCandidates('{"status":"complete"}')).toEqual([
    { status: "complete" },
  ]);
});
