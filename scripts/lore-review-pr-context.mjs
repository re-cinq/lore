import { linkedIssueNumber } from "../libs/shared/dist/domain/pr-body.js";
import { segmentStatements } from "../libs/shared/dist/domain/spec-segment.js";

export const markdown = /\.(?:md|mdx|markdown|mkd|mkdn|mdown)$/i;
const spec = /^specs\/.*\/spec\.md$/;
const maxProductEvidenceBytes = 2 * 1024 * 1024;

// More specs or documents than the product pass is handed; the whole-diff reviewer takes the change.
export class EvidenceLimit extends Error {}

function entry(source, item, detail = "") {
  return {
    source,
    url: item.html_url,
    author: item.user?.login,
    text: [detail, item.title, item.body].filter(Boolean).join("\n\n"),
  };
}

export async function discussionFor(api, target, pr) {
  const issueNumber = linkedIssueNumber(pr.body);
  const comments = (issue_number) =>
    api.paginate(api.rest.issues.listComments, {
      ...target,
      issue_number,
      per_page: 100,
    });
  const pull = { ...target, pull_number: pr.number, per_page: 100 };
  const [conversation, reviews, threads, issue, issueComments] =
    await Promise.all([
      comments(pr.number),
      api.paginate(api.rest.pulls.listReviews, pull),
      api.paginate(api.rest.pulls.listReviewComments, pull),
      issueNumber &&
        api.rest.issues.get({ ...target, issue_number: issueNumber }),
      issueNumber ? comments(issueNumber) : [],
    ]);
  // Keep human replies even when Lore opened the thread.
  const human = (item) => item.user?.type !== "Bot";

  return [
    entry("pull_request", pr),
    ...(issue ? [entry("issue", issue.data)] : []),
    ...issueComments.filter(human).map((item) => entry("issue_comment", item)),
    ...conversation
      .filter(human)
      .map((item) => entry("pull_request_comment", item)),
    ...reviews
      .filter(human)
      .map((item) => entry("pull_request_comment", item, item.state)),
    ...threads
      .filter(human)
      .map((item) =>
        entry(
          "review_thread",
          item,
          [
            item.path,
            item.line ?? item.original_line,
            item.in_reply_to_id && `reply to #${item.in_reply_to_id}`,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      ),
  ];
}

export async function productSpecs(git, base, head, discussion, files) {
  const pathsAt = async (sha) =>
    new Set(
      (await git(["ls-tree", "-r", "--name-only", "-z", sha, "--", "specs"]))
        .split("\0")
        .filter((path) => spec.test(path)),
    );
  const [before, after, changed] = await Promise.all([
    pathsAt(base),
    pathsAt(head),
    git([
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      head,
      "--",
      "specs",
    ]),
  ]);
  const changedPaths = new Set(changed.split("\0"));
  const context = discussion.map((item) => item.text).join("\n");
  const sources = files
    .filter((file) => file.before !== file.after)
    .map((file) => file.path);
  const specs = [];
  let size = 0;

  for (const path of new Set([...before, ...after])) {
    const existing = before.has(path)
      ? await git(["show", base + ":" + path])
      : null;

    if (!(
      changedPaths.has(path) ||
      context.includes(path) ||
      sources.some((file) => existing?.includes(file))
    )) {
      continue;
    }
    const proposed =
      changedPaths.has(path) && after.has(path)
        ? await git(["show", head + ":" + path])
        : changedPaths.has(path)
          ? ""
          : existing;
    const statements = specStatements(path, existing ?? "", proposed, sources);

    specs.push(...statements);
    size = statements.reduce(
      (sum, statement) => sum + Buffer.byteLength(statement.text),
      size,
    );

    if (size > maxProductEvidenceBytes) {
      throw new EvidenceLimit(
        "Relevant product specifications exceed the review evidence limit",
      );
    }
  }

  return specs;
}

export async function productDocuments(git, base, head, scope = []) {
  const documents = await changedMarkdown(
    git,
    [base, head],
    (path) => !spec.test(path) && (!scope.length || scope.includes(path)),
  );
  const size = documents.reduce(
    (sum, { before, after }) =>
      sum + Buffer.byteLength(before ?? "") + Buffer.byteLength(after ?? ""),
    0,
  );

  if (size > maxProductEvidenceBytes) {
    throw new EvidenceLimit(
      "Changed Markdown exceeds the product evidence limit",
    );
  }

  return documents;
}

/** Every Markdown file the range changes that `wanted` keeps, with its text on either side; a file added or removed has no text on the other. */
export async function changedMarkdown(git, [base, head], wanted = () => true) {
  const entries = (
    await git([
      "diff",
      "--raw",
      "-z",
      "--no-abbrev",
      "--no-renames",
      base,
      head,
    ])
  ).split("\0");
  const documents = [];

  for (let index = 0; index < entries.length - 1; index += 2) {
    const path = entries[index + 1];

    if (!markdown.test(path) || !wanted(path)) {
      continue;
    }
    const [beforeMode, afterMode, beforeHash, afterHash] = entries[index]
      .slice(1)
      .split(" ");
    const textOf = (mode, hash) =>
      /^100(?:644|755)$/.test(mode) ? git(["cat-file", "blob", hash]) : null;
    const [before, after] = await Promise.all([
      textOf(beforeMode, beforeHash),
      textOf(afterMode, afterHash),
    ]);

    if (before !== after) {
      documents.push({ path, before, after });
    }
  }

  return documents;
}

/** What a spec says that bears on a pull request: the statements it loses and gains, and the unchanged ones that name a file the pull request touches. A whole spec is never evidence: one of Lore's is 345 KB. */
export function specStatements(path, existing, proposed, touched) {
  const before = segmentStatements(existing);
  const after = segmentStatements(proposed);
  const said = (statements) => new Set(statements.map(({ text }) => text));
  const [was, is] = [said(before), said(after)];
  const entry = (version) => (statement) => ({
    path,
    heading: statement.enclosingHeading,
    version,
    text: statement.text,
  });

  return [
    ...before.filter(({ text }) => !is.has(text)).map(entry("removed")),
    ...after.filter(({ text }) => !was.has(text)).map(entry("proposed")),
    ...after
      .filter(({ text }) => was.has(text))
      .filter(({ text }) => touched.some((file) => text.includes(file)))
      .map(entry("existing")),
  ];
}
