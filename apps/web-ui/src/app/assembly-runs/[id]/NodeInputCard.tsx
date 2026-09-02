// The selected node's recorded brief — what each visit was GIVEN — as its own
// card below the node detail. Per-visit STATE off the walk rows, not the event
// stream: no pod ever echoes its own prompt, and the Agent CR that once held
// it is pruned after the run (run-viz FR4.4j).

import CollapsibleCard from "@/components/CollapsibleCard";
import Markdown from "@/components/Markdown";

const TRUNCATION_MARKER = /…\[truncated, \d+ bytes\]$/;

/** One visit's recorded input, as the panel hands it down. */
export interface NodeInputView {
  iteration: number;
  description: string;
  prompt: string | null;
  params: Record<string, string> | null;
  repo: string;
  ref: string;
}

/** The brief as one text flow — the same body structure as every other card,
 *  never a bespoke tree of paragraphs and definition lists. */
export function inputCardText(input: NodeInputView): string {
  return [
    `${input.repo} @ ${input.ref}`,
    input.description,
    input.prompt,
    ...Object.entries(input.params ?? {}).map(
      ([key, value]) => `${key}: ${value}`,
    ),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function truncated(input: NodeInputView): boolean {
  return (
    TRUNCATION_MARKER.test(input.description) ||
    TRUNCATION_MARKER.test(input.prompt ?? "")
  );
}

export default function NodeInputCard({
  inputs,
}: {
  inputs: readonly NodeInputView[];
}) {
  return (
    <>
      {inputs.map((input) => (
        <CollapsibleCard
          key={input.iteration}
          title="Input"
          labels={[
            inputs.length > 1 ? `iteration ${input.iteration}` : null,
            truncated(input) ? "truncated" : null,
          ]}
        >
          <Markdown markdown={inputCardText(input)} />
        </CollapsibleCard>
      ))}
    </>
  );
}
