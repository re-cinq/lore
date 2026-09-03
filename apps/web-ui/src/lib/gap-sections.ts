// Normalize stored gap result into uniform sections list; mirrors shared's sectionsOf.

import type { GapResult, GapSection } from "./feature-types";

/** Uniform sections list; new or derived from legacy shape. */
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
