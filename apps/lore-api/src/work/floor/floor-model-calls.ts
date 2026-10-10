// A visit's model calls, from its `llm_call` records (run-viz FR4.1i). An agent's result names each model it called with that model's own counts; a service station's `modelCall` records one call. Tokens in count the cache reads and writes, as the floor's own cost sums do.
import type { StationRunRecordView } from "@re-cinq/floor-client";

export interface ModelCall {
  seq: number;
  occurredAt: string;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

type Counts = Record<string, unknown>;

export function modelCallsOf(
  records: readonly StationRunRecordView[],
): ModelCall[] {
  return records.flatMap(rowsOfRecord);
}

function rowsOfRecord(record: StationRunRecordView): ModelCall[] {
  const body = objectOf(record.body);
  const models = objectOf(body.models);
  const at = { seq: record.seq, occurredAt: record.occurredAt };

  if (Object.keys(models).length > 0) {
    return namedModelCalls(models, at);
  }

  return [
    {
      ...at,
      model: typeof body.model === "string" ? body.model : null,
      costUsd: numberOf(body.costUsd),
      ...usageTokens(objectOf(body.usage)),
    },
  ];
}

/** An agent's result names each model it called, with that model's own counts and cost. */
function namedModelCalls(
  models: Counts,
  at: Pick<ModelCall, "seq" | "occurredAt">,
): ModelCall[] {
  return Object.entries(models).map(([model, counts]) => ({
    ...at,
    model,
    costUsd: numberOf(objectOf(counts).cost_usd),
    ...usageTokens(objectOf(counts)),
  }));
}

function usageTokens(
  counts: Counts,
): Pick<ModelCall, "tokensIn" | "tokensOut"> {
  const input = numberOf(counts.input_tokens);

  return {
    tokensIn:
      input === null
        ? null
        : input +
          (numberOf(counts.cache_read_input_tokens) ?? 0) +
          (numberOf(counts.cache_creation_input_tokens) ?? 0),
    tokensOut: numberOf(counts.output_tokens),
  };
}

function objectOf(value: unknown): Counts {
  return typeof value === "object" && value !== null ? (value as Counts) : {};
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
