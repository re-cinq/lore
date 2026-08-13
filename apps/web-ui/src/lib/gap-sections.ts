// Normalizing a stored gap result into a uniform sections list.
//
// A RUNTIME function, which is why it cannot live in feature-types.ts any more:
// that file is now aliases over the generated OpenAPI schema, and a generated
// `.d.ts` carries no code. It duplicates shared's `sectionsOf`
// (libs/shared/src/feature-planning/gap-result.ts) because web-ui is not an npm
// workspace member and cannot import it; feature-types.parity.test.ts pins the two
// together.
//
// Why the client still normalizes at all: the planning pages read `gap_result`
// straight from Postgres, so there is no server hop that could normalize legacy
// rows on the way out.

import type { GapResult, GapSection } from "./feature-types";

/** A uniform sections list — new `sections` if present, else derived from the legacy
 *  shape so old stored results still render. Mirrors shared's `sectionsOf`. */
export function sectionsOf(gap: GapResult | null | undefined): GapSection[] {
  if (!gap) {
    return [];
  }

  if (gap.sections) {
    return gap.sections;
  }
  const sections: GapSection[] = [];
  const mockupsFor = (key: string) =>
    (gap.mockups ?? []).filter((m) => (m.section ?? "architecture") === key);

  if (gap.architecture) {
    const a = gap.architecture;
    const lines = [
      a.summary,
      ...(a.components ?? []).map(
        (c) => `- **${c.name}**: ${c.responsibility}`,
      ),
    ];
    const m = mockupsFor("architecture");

    sections.push({
      title: "Architecture",
      content: lines.join("\n"),
      ...(m.length ? { mockups: m } : {}),
    });
  }

  if (gap.user_flows?.length) {
    const content = gap.user_flows
      .map((f) =>
        [`**${f.name}**`, ...f.steps.map((s, i) => `${i + 1}. ${s}`)].join(
          "\n",
        ),
      )
      .join("\n\n");
    const m = mockupsFor("user_flows");

    sections.push({
      title: "User flows",
      content,
      ...(m.length ? { mockups: m } : {}),
    });
  }

  if (gap.questions?.length) {
    sections.push({ title: "Open questions", questions: gap.questions });
  }

  return sections;
}
