/** Only the keys the app actually answers; the shortcuts dialog never lists a promise. */
export const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["⌘K"], description: "Search or jump to anything" },
  { keys: ["Ctrl", "K"], description: "Search or jump to anything" },
  { keys: ["/"], description: "Search or jump to anything" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["↑", "↓"], description: "Move through the palette's results" },
  { keys: ["Enter"], description: "Open the selected result" },
  { keys: ["Esc"], description: "Close a panel or dialog" },
];

/** The words Lore uses that a newcomer would not already know. */
export const GLOSSARY: { term: string; definition: string }[] = [
  {
    term: "Repo",
    definition:
      "A GitHub repository onboarded to Lore. Its specs, ADRs and code are ingested so agents and search can use them.",
  },
  {
    term: "Assembly line",
    definition:
      "A reusable pipeline of stations, such as code-review or implementation-loop.",
  },
  {
    term: "Assembly run",
    definition: "One execution of a line against an issue or a pull request.",
  },
  {
    term: "Station",
    definition:
      "One step in a line. Service stations run code, agent stations run a model, human stations wait for a person.",
  },
  {
    term: "Agent",
    definition:
      "A model running in a pod with Lore's context tools, configured per task type by an agent definition.",
  },
  {
    term: "Spec",
    definition:
      "A feature specification (spec.md). Its statements link to the tests that validate them.",
  },
  {
    term: "ADR",
    definition:
      "An architecture decision record: one decision, its context and its consequences.",
  },
  {
    term: "Episode",
    definition:
      "Raw text Lore ingests, such as conversations and reviews. Facts are extracted from it.",
  },
  {
    term: "Pool",
    definition: "A shared memory namespace that several agents write to.",
  },
  {
    term: "Gap",
    definition:
      "Missing context: a search that returned nothing, or a finding from gap detection.",
  },
];
