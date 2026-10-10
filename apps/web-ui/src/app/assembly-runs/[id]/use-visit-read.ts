// One visit's read, kept current (run-viz FR4.1i): read on mount and again when the attempt's outcome moves, a newer read cancelling the one in flight and an answer that lands after it being dropped.
import { useEffect, useState } from "react";

export type VisitReader<Answer> = (
  runId: string,
  visitId: string,
  cancel?: AbortSignal,
) => Promise<Answer[]>;

export function useVisitRead<Answer>(
  reader: VisitReader<Answer>,
  runId: string,
  visitId: string | null | undefined,
  refreshKey: string,
): Answer[] {
  const [answers, setAnswers] = useState<Answer[]>([]);

  useEffect(() => {
    if (!visitId) {
      return;
    }
    const read = new AbortController();

    void readInto({ reader, runId, visitId, read, setAnswers });

    return () => read.abort();
  }, [reader, runId, visitId, refreshKey]);

  return answers;
}

interface ReadInto<Answer> {
  reader: VisitReader<Answer>;
  runId: string;
  visitId: string;
  read: AbortController;
  setAnswers: (answers: Answer[]) => void;
}

async function readInto<Answer>(ask: ReadInto<Answer>): Promise<void> {
  const { signal } = ask.read;

  try {
    const next = await ask.reader(ask.runId, ask.visitId, signal);

    if (!signal.aborted) {
      ask.setAnswers(next);
    }
  } catch {
    // A cancelled or failed read leaves what is shown; the next refresh asks again.
  }
}
