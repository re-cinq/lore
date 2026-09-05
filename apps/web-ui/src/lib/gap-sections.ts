// Normalize stored gap result into uniform sections list; mirrors shared's sectionsOf.

import type { GapResult, GapSection } from "./feature-types";

function mockupsFor(gap: GapResult, key: string) {
  return (gap.mockups ?? []).filter(
    (m) => (m.section ?? "architecture") === key,
  );
}

function architectureSection(gap: GapResult): GapSection | null {
  if (!gap.architecture) {
    return null;
  }
  const a = gap.architecture;
  const lines = [
    a.summary,
    // openapi marks `components` required, but this is LLM-authored JSON that can omit the array.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(a.components ?? []).map((c) => `- **${c.name}**: ${c.responsibility}`),
  ];
  const m = mockupsFor(gap, "architecture");

  return {
    title: "Architecture",
    content: lines.join("\n"),
    ...(m.length ? { mockups: m } : {}),
  };
}

function userFlowsSection(gap: GapResult): GapSection | null {
  if (!gap.user_flows?.length) {
    return null;
  }
  const content = gap.user_flows
    .map((f) =>
      [`**${f.name}**`, ...f.steps.map((s, i) => `${i + 1}. ${s}`)].join("\n"),
    )
    .join("\n\n");
  const m = mockupsFor(gap, "user_flows");

  return {
    title: "User flows",
    content,
    ...(m.length ? { mockups: m } : {}),
  };
}

function questionsSection(gap: GapResult): GapSection | null {
  return gap.questions?.length
    ? { title: "Open questions", questions: gap.questions }
    : null;
}

/** Uniform sections list; new or derived from legacy shape. */
export function sectionsOf(gap: GapResult | null | undefined): GapSection[] {
  if (!gap) {
    return [];
  }

  if (gap.sections) {
    return gap.sections;
  }

  return [
    architectureSection(gap),
    userFlowsSection(gap),
    questionsSection(gap),
  ].filter((section): section is GapSection => section !== null);
}
