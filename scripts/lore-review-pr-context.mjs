import { linkedIssueNumber } from "../libs/shared/dist/domain/pr-body.js";

const markdown = /\.(?:md|mdx|markdown|mkd|mkdn|mdown)$/i;
const spec = /^specs\/.*\/spec\.md$/;
const maxProductEvidenceBytes = 2 * 1024 * 1024;

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
    const added = specs.length;

    if (existing !== null) {
      specs.push({ path, version: "existing", text: existing });
    }

    if (changedPaths.has(path)) {
      specs.push({
        path,
        version: "proposed",
        text: after.has(path)
          ? await git(["show", head + ":" + path])
          : "(deleted)",
      });
    }
    size = specs
      .slice(added)
      .reduce((sum, spec) => sum + Buffer.byteLength(spec.text), size);

    if (size > maxProductEvidenceBytes) {
      throw new Error(
        "Relevant product specifications exceed the review evidence limit",
      );
    }
  }

  return specs;
}

export async function productDocuments(git, base, head) {
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
  let size = 0;

  for (let index = 0; index < entries.length - 1; index += 2) {
    const path = entries[index + 1];

    if (!markdown.test(path) || spec.test(path)) {
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

    if (before === after) {
      continue;
    }

    size += Buffer.byteLength(before ?? "") + Buffer.byteLength(after ?? "");

    if (size > maxProductEvidenceBytes) {
      throw new Error("Changed Markdown exceeds the product evidence limit");
    }
    documents.push({ path, before, after });
  }

  return documents;
}
