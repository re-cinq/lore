// The names the mirror gives entities. Utopia resolves an entity by its lower-cased name, so every builder that names the same thing must name it here.

export function fileName(repo: string, path: string): string {
  return `${repo}:${path}`;
}

export function sectionName(doc: string, slug: string): string {
  return `${doc}#${slug}`;
}

export function statementName(
  repo: string,
  path: string,
  ordinal: number,
): string {
  return `${fileName(repo, path)}#s${String(ordinal).padStart(4, "0")}`;
}

/** A top-level definition in a source file, named by the symbol it defines. */
export function definitionName(
  repo: string,
  path: string,
  symbol: string,
): string {
  return `${fileName(repo, path)}#${symbol}`;
}

export function testName(repo: string, path: string, title: string): string {
  return `${fileName(repo, path)}::${title}`;
}

/** The default branch's tree, which GitHub resolves from `HEAD`: a link that names no commit stays the same from run to run, so an unchanged item re-pushes byte for byte and Utopia keeps no new version of it. */
export function blobUrl(repo: string): string {
  return `https://github.com/${repo}/blob/HEAD`;
}

/** A commit, a pull request and an issue are named as their GitHub page's path, so `https://github.com/<name>` is each one's permalink and a pull request and an issue with one number stay apart. */
export function commitName(repo: string, sha: string): string {
  return `${repo}/commit/${sha}`;
}

export function pullRequestName(repo: string, number: number): string {
  return `${repo}/pull/${number}`;
}

export function issueName(repo: string, number: number): string {
  return `${repo}/issues/${number}`;
}

/** A release and a tag are named as their GitHub page's path too, so a release and a branch-like tag with one name stay apart. */
export function releaseName(repo: string, tag: string): string {
  return `${repo}/releases/tag/${tag}`;
}

export function tagName(repo: string, tag: string): string {
  return `${repo}/tree/${tag}`;
}

/** The lower-case, dash-joined words of a title, at most 60 characters, for the filename a Library lists a record under. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/** `<id>-<slug of the title>.md`, the id alone when the title leaves no slug. */
export function markdownFilename(id: string, title: string): string {
  return `${[id, slug(title)].filter((part) => part !== "").join("-")}.md`;
}

export function githubPage(name: string): string {
  return `https://github.com/${name}`;
}

/** A person is named as their GitHub profile's path, so a commit's author and a pull request's author with one login are one entity. */
export function personName(login: string): string {
  return `github.com/${login}`;
}
