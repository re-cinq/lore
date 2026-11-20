import { posix } from "node:path";
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
        heading: z.string().nullable().optional(),
        version: z
          .enum(["existing", "proposed", "removed"])
          .default("existing"),
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

const MARGIN = 10;

export function referenceStem(path) {
  const filename = posix.basename(path, posix.extname(path));
  const stem = filename.replace(
    /(?:[._-](?:test|spec|tests)|Tests?|^test_)/g,
    "",
  );

  return /^(?:index|mod|main|lib)$/.test(stem)
    ? posix.basename(posix.dirname(path))
    : stem;
}

/** Where a text names one of the stems: each naming line with its margin, overlapping ranges merged, every line led by its number in the file. */
function usesOf(text, stems) {
  const lines = text.split("\n");
  const named = new RegExp(
    `\\b(?:${stems.map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  );
  const blocks = [];

  lines.forEach((line, index) => {
    if (!named.test(line)) {
      return;
    }
    const range = [
      Math.max(0, index - MARGIN),
      Math.min(lines.length - 1, index + MARGIN),
    ];
    const last = blocks.at(-1);

    if (last && range[0] <= last[1] + 1) {
      last[1] = range[1];
    } else {
      blocks.push(range);
    }
  });

  return blocks.map(([from, to]) =>
    lines.slice(from, to + 1).map((line, at) => `${from + at + 1}| ${line}`),
  );
}

// An unchanged file that only uses the changed code goes as those uses: whole, such files were four fifths of a packet.
function unchangedFile({ path, after }, changedStems) {
  const uses =
    after === null || changedStems.includes(referenceStem(path))
      ? []
      : usesOf(after, changedStems);

  return uses.length ? { path, uses } : { path, unchanged: after };
}

function packetFile(file, changedStems) {
  const { path, before, after, diff } = file;

  if (before === after) {
    return unchangedFile(file, changedStems);
  }

  return diff ? { path, diff, after } : { path, before, after };
}

function packetFor(mode, files) {
  const selected = [];
  const changedStems = files
    .filter((file) => file.before !== file.after)
    .map((file) => referenceStem(file.path))
    .filter(Boolean);

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
    selected.push(packetFile(file, changedStems));
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
