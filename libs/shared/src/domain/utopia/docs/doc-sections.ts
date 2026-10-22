// The headings of a markdown document as the sections a statement sits under.

import { sectionName } from "../names.js";

export interface SectionRef {
  name: string;
  title: string;
  line: number;
  depth: number;
}

/** Every heading outside a code fence, named by its slug; a repeated heading gets -2, -3 so names stay unique within the document. */
export function sectionsOf(content: string, doc: string): SectionRef[] {
  const seen = new Map<string, number>();
  const sections: SectionRef[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    inFence = /^\s*```/.test(line) ? !inFence : inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(\S.*)$/.exec(line);

    if (heading) {
      const title = heading[2].trim();
      const slug = uniqueSlug(slugOf(title), seen);

      sections.push({
        name: sectionName(doc, slug),
        title,
        line: index + 1,
        depth: heading[1].length,
      });
    }
  });

  return sections;
}

function uniqueSlug(slug: string, seen: Map<string, number>): string {
  const count = (seen.get(slug) ?? 0) + 1;

  seen.set(slug, count);

  return count === 1 ? slug : `${slug}-${count}`;
}

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
