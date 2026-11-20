import { z } from "zod";
import { isTestFile } from "../libs/shared/dist/domain/test-paths.js";

const modes = ["code", "tests", "test challenge"];

const snapshot = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      role: z.enum(["code", "test"]),
      before: z.string().nullable(),
      after: z.string().nullable(),
      diff: z.string().optional(),
    }),
  ),
  discussion: z
    .array(
      z.object({
        source: z.enum([
          "pull_request",
          "issue",
          "issue_comment",
          "pull_request_comment",
          "review_thread",
        ]),
        url: z.url(),
        author: z.string().optional(),
        text: z.string(),
      }),
    )
    .default([]),
  specs: z
    .array(
      z.object({
        path: z.string().min(1),
        text: z.string(),
        version: z.enum(["existing", "proposed"]).default("existing"),
      }),
    )
    .default([]),
  documents: z
    .array(
      z.object({
        path: z.string().min(1),
        before: z.string().nullable(),
        after: z.string().nullable(),
      }),
    )
    .optional(),
});

function packetFile({ path, before, after, diff }) {
  if (before === after) {
    return { path, unchanged: after };
  }

  return diff ? { path, diff, after } : { path, before, after };
}

function packetFor(mode, files) {
  const selected = [];

  for (const file of files) {
    if (/\.(md|mdx|markdown|mkd|mkdn|mdown)$/i.test(file.path)) {
      continue;
    }
    const test =
      file.role === "test" ||
      isTestFile(file.path) ||
      /(?:^|\/)(?:tests?|__mocks__|__fixtures__)\//i.test(file.path);

    if ((mode === "code" && test) || (mode === "tests" && !test)) {
      continue;
    }
    selected.push(packetFile(file));
  }

  return { mode, files: selected };
}

export function reviewPackets(input) {
  const { files, discussion, specs, documents } = snapshot.parse(input);

  for (const file of files) {
    if (file.role === "test" || isTestFile(file.path)) {
      continue;
    }
    const inlineTests = [file.before, file.after].some(
      (source) =>
        source &&
        (isTestFile(file.path, source) ||
          (file.path.endsWith(".rs") && /#\[cfg\(test\)\]/.test(source)) ||
          (/\.[cm]?[jt]sx?$/.test(file.path) &&
            /\bimport\.meta\.vitest\b/.test(source))),
    );

    if (inlineTests) {
      throw new Error(
        `Separate the code and inline test regions in ${file.path}`,
      );
    }
  }
  const packets = modes.map((mode) => packetFor(mode, files));

  return [
    ...packets,
    { mode: "intent", discussion },
    { mode: "product", specs, ...(documents?.length ? { documents } : {}) },
  ];
}

/** The three packets of the one-story review: what the tests assert, what the code does, and what the issue, the discussion and the specs ask for. */
export function storyPackets(input) {
  const [code, tests, , intent, product] = reviewPackets(input);
  const { mode: _intent, ...asked } = intent;
  const { mode: _product, ...promised } = product;

  return {
    test_evidence: tests,
    code_evidence: code,
    issue_evidence: { mode: "issue", ...asked, ...promised },
  };
}
