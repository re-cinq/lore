/** Normalizes a pre-dynamic-sections GapResult payload (architecture/user_flows/mockups/questions) into the current `sections[]` shape. */

import {
  asObject,
  asString,
  asArray,
  asStringArray,
  firstString,
  lenientStringArray,
  parseMockup,
  parseQuestion,
  type GapMockup,
  type GapSection,
} from "./gap-result-primitives.js";

// Legacy (pre-dynamic-sections) shapes, kept only to normalize old stored results into `sections`.
export interface ArchitectureComponent {
  name: string;
  responsibility: string;
  touchpoints: string[];
}
export interface GapArchitecture {
  summary: string;
  components: ArchitectureComponent[];
}
export interface GapUserFlow {
  name: string;
  steps: string[];
}

function parseArchitecture(raw: unknown): GapArchitecture {
  const o = asObject(raw, "architecture");

  return {
    summary: firstString(o.summary, o.description),
    components: asArray(o.components, "architecture.components").map((c, i) => {
      const co = asObject(c, `architecture.components[${i}]`);

      return {
        name: asString(co.name, `architecture.components[${i}].name`),
        responsibility: firstString(
          co.responsibility,
          co.description,
          co.summary,
        ),
        touchpoints: lenientStringArray(co.touchpoints),
      };
    }),
  };
}

/** Render an architecture payload as markdown: summary + one bullet per component. */
function architectureContent(arch: GapArchitecture): string {
  const lines = [arch.summary];

  if (arch.components.length) {
    lines.push(
      "",
      ...arch.components.map(
        (c) =>
          `- **${c.name}**: ${c.responsibility}${c.touchpoints.length ? ` _(${c.touchpoints.join(", ")})_` : ""}`,
      ),
    );
  }

  return lines.join("\n");
}

type MockupsForSection = (key: string) => GapMockup[] | undefined;

function deriveMockups(o: Record<string, unknown>): GapMockup[] {
  return Array.isArray(o.mockups)
    ? o.mockups.map(parseMockup).filter((m): m is GapMockup => m !== null)
    : [];
}

function mockupsTaggedBy(mockups: GapMockup[]): MockupsForSection {
  return (key) => {
    const tagged = mockups.filter(
      (mk) => (mk.section ?? "architecture") === key,
    );

    return tagged.length ? tagged : undefined;
  };
}

function deriveArchitectureSection(
  o: Record<string, unknown>,
  mockupsTagged: MockupsForSection,
): GapSection | null {
  if (o.architecture === undefined || o.architecture === null) {
    return null;
  }
  const arch = parseArchitecture(o.architecture);
  const m = mockupsTagged("architecture");

  return {
    title: "Architecture",
    content: architectureContent(arch),
    ...(m ? { mockups: m } : {}),
  };
}

function userFlowContent(flow: unknown, i: number): string {
  const fo = asObject(flow, `user_flows[${i}]`);
  const name = asString(fo.name, `user_flows[${i}].name`);
  const steps = asStringArray(fo.steps, `user_flows[${i}].steps`);

  return [`**${name}**`, ...steps.map((s, j) => `${j + 1}. ${s}`)].join("\n");
}

function deriveUserFlowsSection(
  o: Record<string, unknown>,
  mockupsTagged: MockupsForSection,
): GapSection | null {
  if (!Array.isArray(o.user_flows) || !o.user_flows.length) {
    return null;
  }
  const content = o.user_flows.map(userFlowContent).join("\n\n");
  const m = mockupsTagged("user_flows");

  return {
    title: "User flows",
    content,
    ...(m ? { mockups: m } : {}),
  };
}

function orphanMockupsSection(mockups: GapMockup[]): GapSection | null {
  const orphans = mockups.filter(
    (mk) =>
      !["architecture", "user_flows"].includes(mk.section ?? "architecture"),
  );

  return orphans.length ? { title: "Diagrams", mockups: orphans } : null;
}

function openQuestionsSection(o: Record<string, unknown>): GapSection | null {
  if (!Array.isArray(o.questions) || !o.questions.length) {
    return null;
  }

  return { title: "Open questions", questions: o.questions.map(parseQuestion) };
}

/** Build `sections` from a legacy architecture/user_flows/mockups/questions payload. */
export function deriveSectionsFromLegacy(
  o: Record<string, unknown>,
): GapSection[] {
  const mockups = deriveMockups(o);
  const mockupsTagged = mockupsTaggedBy(mockups);
  const candidates = [
    deriveArchitectureSection(o, mockupsTagged),
    deriveUserFlowsSection(o, mockupsTagged),
    orphanMockupsSection(mockups),
    openQuestionsSection(o),
  ];

  return candidates.filter((s): s is GapSection => s !== null);
}
