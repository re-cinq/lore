import type { ResolvedDigestSettings } from "../../domain/digest-settings.js";
import type { DigestGroup, DigestChange } from "./group.js";

/** The digest as Slack mrkdwn (specs/daily-digest FR6): one section per repo, groups as bold headers, items as links; the draft the refine agent receives carries markers where its intro and ending go and an appendix of what it must not repeat. */

export const INTRO_MARKER = "<!-- lore-digest:intro -->";
export const ENDING_MARKER = "<!-- lore-digest:ending -->";
export const APPENDIX_MARKER = "<!-- lore-digest:appendix -->";
/** Where the agent writes one line reacting to the section just above it; placed only when a voice is set. */
export const ASIDE_MARKER = "<!-- lore-digest:aside -->";
export const ROADMAP_CAP = 10;

export interface RepoSectionInput {
  repo: string;
  settings: ResolvedDigestSettings;
  implemented?: DigestGroup[];
  roadmap?: DigestGroup[];
  /** Why the repo could not be read; renders instead of the lists. */
  error?: string;
  /** A group key's display name (GitHub login → Slack name); a key without one shows as itself. */
  names?: Record<string, string>;
  /** Put an aside marker after each enabled section (FR13). */
  asides?: boolean;
}

export function renderRepoSection(input: RepoSectionInput): string {
  const { repo, error } = input;

  if (error) {
    return `*${repo}*\n_could not read ${repo}: ${error}_`;
  }

  return [
    `*${repo}*`,
    ...LISTS.flatMap((list) => renderList(list, input)),
  ].join("\n");
}

interface ListSpec {
  section: "implemented" | "roadmap";
  title: string;
  cap: number;
  empty: string;
}

/** The two lists a repo section can carry, in the order they are shown. */
const LISTS: ListSpec[] = [
  {
    section: "implemented",
    title: "_Implemented_",
    cap: Infinity,
    empty: "Nothing merged or closed since the last digest.",
  },
  {
    section: "roadmap",
    title: "_Roadmap_",
    cap: ROADMAP_CAP,
    empty: "No assigned open issues.",
  },
];

/** One list's lines, or none when the repo did not enable its section. */
function renderList(list: ListSpec, input: RepoSectionInput): string[] {
  const { sections } = input.settings;

  if (!sections.includes(list.section)) {
    return [];
  }

  return [
    list.title,
    ...renderGroups(
      named(input[list.section], input.names),
      list.cap,
      list.empty,
    ),
    ...(input.asides ? [ASIDE_MARKER] : []),
  ];
}

/** Groups keyed by their display name, where one is known; the grouping itself stays by login, so one person is one group. */
function named(
  groups: DigestGroup[] | undefined,
  names: Record<string, string> | undefined,
): DigestGroup[] {
  return (groups ?? []).map((group) => ({
    ...group,
    key: names?.[group.key] ?? group.key,
  }));
}

function renderGroups(
  groups: DigestGroup[],
  cap: number,
  empty: string,
): string[] {
  if (groups.length === 0) {
    return [`_${empty}_`];
  }

  return groups.flatMap((group) => [
    `*${group.key}*`,
    ...renderChanges(group.changes, cap),
  ]);
}

function renderChanges(changes: DigestChange[], cap: number): string[] {
  const shown = changes.slice(0, cap).map(renderChange);
  const rest = changes.length - shown.length;

  return rest > 0 ? [...shown, `  _+${rest} more_`] : shown;
}

function renderChange(change: DigestChange): string {
  const title = change.url ? `<${change.url}|${change.title}>` : change.title;

  return `• ${title} (#${change.number})`;
}

export interface DigestDraftInput {
  header: { weekKey: string; date: string };
  sections: string[];
  wantsIntro: boolean;
  wantsEnding: boolean;
  recent: Array<{ intro: string; ending: string }>;
  /** Who the agent writes as; empty for a plain friendly tone. */
  voice?: string;
}

export function renderDigestDraft(input: DigestDraftInput): string {
  const { header, sections, wantsIntro, wantsEnding, recent } = input;
  const paragraphs = [
    ...(wantsIntro ? [INTRO_MARKER] : []),
    `*Daily digest · ${header.date}*`,
    ...sections,
    ...(wantsEnding ? [ENDING_MARKER] : []),
    renderAppendix(recent, input.voice ?? ""),
  ];

  return paragraphs.join("\n\n");
}

function renderAppendix(
  recent: Array<{ intro: string; ending: string }>,
  voice: string,
): string {
  const lines = recent.flatMap(({ intro, ending }) => [
    ...(intro ? [`- intro: ${intro}`] : []),
    ...(ending ? [`- ending: ${ending}`] : []),
  ]);

  return [
    APPENDIX_MARKER,
    ...(voice ? [`Voice: ${voice}`] : []),
    "Recent intros and endings already posted in this channel. Write something different in wording and angle:",
    ...(lines.length > 0 ? lines : ["(none yet)"]),
  ].join("\n");
}

/** The draft as postable text: the appendix and any marker the refine never filled are gone. */
const UNFILLED = new Set([INTRO_MARKER, ENDING_MARKER, ASIDE_MARKER]);

export function stripAppendix(text: string): string {
  const [message] = text.split(APPENDIX_MARKER);

  return message
    .split("\n")
    .filter((line) => !UNFILLED.has(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DigestMessageParts {
  intro: string;
  body: string;
  ending: string;
}

/** The intro is the first paragraph and the ending the last, when they are prose: a paragraph opening with a bold header or an italic note is a section, never a creation. */
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
