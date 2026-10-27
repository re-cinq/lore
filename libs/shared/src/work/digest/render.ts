import type { DigestChange, PersonWork } from "./group.js";

/** The digest as Slack mrkdwn (specs/daily-digest FR6): one paragraph per person, their name on its own line over a bullet for what they did and one for what is next; the draft the refine agent receives carries a marker where its intro goes and an appendix of what it must not repeat. */

export const INTRO_MARKER = "<!-- lore-digest:intro -->";
export const APPENDIX_MARKER = "<!-- lore-digest:appendix -->";
/** How many titles a person's next shows before it counts the rest; their did shows every title, so the refine agent can sum up all of it. */
export const LIST_CAP = 3;

const NOTHING = "_Nothing merged, closed or planned since the last digest._";

/** Every person's block, sorted by the name it shows: the Slack display name where one is known, the GitHub login otherwise. */
export function renderPeople(
  people: PersonWork[],
  names: Record<string, string>,
): string[] {
  return people
    .map((person) => ({ ...person, name: names[person.login] ?? person.login }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(renderPersonBlock);
}

function renderPersonBlock(person: PersonWork & { name: string }): string {
  const lists = [
    renderList("did", person.did, person.did.length),
    renderList("next", person.next, LIST_CAP),
  ].filter(Boolean);

  return [`*${person.name}*`, ...lists].join("\n");
}

function renderList(
  label: string,
  changes: DigestChange[],
  cap: number,
): string {
  if (changes.length === 0) {
    return "";
  }
  const shown = changes.slice(0, cap).map(renderChange);
  const rest = changes.length - shown.length;

  return `• ${label}: ${[...shown, ...(rest > 0 ? [`+${rest} more`] : [])].join(", ")}`;
}

function renderChange(change: DigestChange): string {
  const title = change.url ? `<${change.url}|${change.title}>` : change.title;

  return `${title} (#${change.number})`;
}

export function renderRepoFailure(repo: string, error: string): string {
  return `_could not read ${repo}: ${error}_`;
}

/** `Full list: <…/repos/re-cinq/lore/changelog|lore> · …`, a link to the Changelog tab of each repo the digest covers (specs/repo-changelog FR6). */
export function renderChangelogLinks(uiUrl: string, repos: string[]): string {
  const base = uiUrl.replace(/\/+$/, "");
  const links = repos.map(
    (repo) => `<${base}/repos/${repo}/changelog|${repo.split("/").at(-1)}>`,
  );

  return `Full list: ${links.join(" · ")}`;
}

export interface DigestDraftInput {
  header: { weekKey: string; date: string };
  /** One block per person, then one line per repo that could not be read; each its own paragraph. */
  lines: string[];
  /** The changelog links, the last paragraph. */
  footer?: string;
  wantsIntro: boolean;
  recentIntros: string[];
  /** Who the agent writes the intro as; empty for a plain friendly tone. */
  voice?: string;
}

export function renderDigestDraft(input: DigestDraftInput): string {
  const { header, lines, wantsIntro } = input;
  const paragraphs = [
    ...(wantsIntro ? [INTRO_MARKER] : []),
    [
      `*Daily digest · ${header.date}*`,
      ...(lines.length > 0 ? [] : [NOTHING]),
    ].join("\n"),
    ...lines,
    ...(input.footer ? [input.footer] : []),
    renderAppendix(input.recentIntros, input.voice ?? ""),
  ];

  return paragraphs.join("\n\n");
}

function renderAppendix(intros: string[], voice: string): string {
  return [
    APPENDIX_MARKER,
    ...(voice ? [`Voice: ${voice}`] : []),
    "Recent intros already posted in this channel. Write something different in wording and angle:",
    ...(intros.length > 0
      ? intros.map((intro) => `- ${intro}`)
      : ["(none yet)"]),
  ].join("\n");
}

/** The draft as postable text: the appendix and an intro marker the refine never filled are gone. */
export function stripAppendix(text: string): string {
  const [message] = text.split(APPENDIX_MARKER);

  return message
    .split("\n")
    .filter((line) => line !== INTRO_MARKER)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DigestMessageParts {
  intro: string;
  body: string;
  ending: string;
}

/** The intro is the first paragraph and the ending the last, when they are prose: a paragraph opening with a bold header or an italic note is the digest itself, never a creation. Digests no longer end on prose; the ending is still read so a message that does keeps its text apart. */
export function splitDigestMessage(text: string): DigestMessageParts {
  const paragraphs = text.trim().split(/\n{2,}/);
  const intro = isProse(paragraphs[0]) ? (paragraphs.shift() ?? "") : "";
  const last = paragraphs.at(-1);
  const ending =
    paragraphs.length > 0 && isProse(last) ? (paragraphs.pop() ?? "") : "";

  return { intro, body: paragraphs.join("\n\n"), ending };
}

function isProse(paragraph: string | undefined): boolean {
  return paragraph !== undefined && !/^[*_<•]/.test(paragraph);
}

export function renderThreadParent(weekKey: string, repos: string[]): string {
  const week = Number(weekKey.split("-W")[1]);

  return `Week ${week} · ${repos.join(", ")}`;
}
