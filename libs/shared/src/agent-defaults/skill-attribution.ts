export interface AttributionFacts {
  sourceUrls: string[];
  creditLines: string[];
  licenceIds: string[];
  statesModification: boolean;
}

const SECTION_BEFORE_HELP = /\n## Attribution\n([\s\S]*?)\n## Help\n/;
const SOURCE_URL = /https:\/\/[^\s)`>]+/g;
const CREDIT_LINE = /Copyright \(c\) \d{4} [^,.]+|Authors: [^.]+/g;
const LICENCE_ID = /\b(?:MIT|CC-BY-SA-4\.0)\b/g;
const MODIFICATION_STATEMENT = "Modified by re:cinq";

export function attributionSectionOf(content: string): string | undefined {
  return content.match(SECTION_BEFORE_HELP)?.[1];
}

export function attributionFactsOf(section: string): AttributionFacts {
  return {
    sourceUrls: matchesOf(section, SOURCE_URL),
    creditLines: matchesOf(section, CREDIT_LINE),
    licenceIds: matchesOf(section, LICENCE_ID),
    statesModification: section.includes(MODIFICATION_STATEMENT),
  };
}

function matchesOf(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])];
}

export function hasCompleteAttribution(content: string): boolean {
  const section = attributionSectionOf(content);

  return section !== undefined && isComplete(attributionFactsOf(section));
}

function isComplete(facts: AttributionFacts): boolean {
  const lists = [facts.sourceUrls, facts.creditLines, facts.licenceIds];

  return facts.statesModification && lists.every((list) => list.length > 0);
}
