"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import {
  outcomeLines,
  type MirrorMove,
  type MirrorMoveRequest,
  type MoveSummary,
} from "./mirror-move-outcome";
import styles from "./MoveMirror.module.css";

interface MoveMirrorButtonProps {
  /** The saved mirror's full name, which the person types to confirm. */
  mirror: string;
  move: MirrorMove;
}

type Stage =
  { step: "idle" } | { step: "preview" | "done"; summary: MoveSummary };

/** Moves what the public mirror stored under its own name to this repository: a dry run first, then a typed confirmation. */
export default function MoveMirrorButton({
  mirror,
  move,
}: MoveMirrorButtonProps) {
  const { stage, said, ask } = useMoveStage(move);

  return (
    <div className={styles.move}>
      <Step
        stage={stage}
        mirror={mirror}
        onPreview={() => ask({ dry_run: true }, "preview")}
        onConfirm={() => ask({ confirm: mirror, dry_run: false }, "done")}
      />
      {said && <Refusal said={said} />}
    </div>
  );
}

function Refusal({ said }: { said: string }) {
  return (
    <p role="alert" className={styles.refusal}>
      {said}
    </p>
  );
}

/** The stage the card is at and the refusal to show; `ask` sends a request and moves to `step` when the route answers it. */
function useMoveStage(move: MirrorMove) {
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [said, setSaid] = useState<string | null>(null);

  async function ask(request: MirrorMoveRequest, step: "preview" | "done") {
    const outcome = await move(request);

    setSaid(outcome.ok ? null : outcome.said);

    setStage(
      outcome.ok ? { step, summary: outcome.summary } : { step: "idle" },
    );
  }

  return { stage, said, ask };
}

interface StepProps {
  stage: Stage;
  mirror: string;
  onPreview: () => Promise<void>;
  onConfirm: () => Promise<void>;
}

function Step({ stage, mirror, onPreview, onConfirm }: StepProps) {
  if (stage.step === "done") {
    return <Outcome summary={stage.summary} />;
  }

  if (stage.step === "preview") {
    return (
      <>
        <Preview summary={stage.summary} />
        <ConfirmMove mirror={mirror} onConfirm={onConfirm} />
      </>
    );
  }

  return <PreviewButton onPreview={onPreview} />;
}

function PreviewButton({ onPreview }: { onPreview: () => Promise<void> }) {
  return (
    <PendingActionButton
      action={onPreview}
      text="Preview the move of the mirror's knowledge here"
      pendingText="Counting what would move…"
      className=""
    />
  );
}

function Preview({ summary }: { summary: MoveSummary }) {
  if (summary.nothingToMove) {
    return <p className={styles.note}>Nothing would move.</p>;
  }

  return <CountsTable tables={summary.tables} />;
}

function CountsTable({ tables }: { tables: MoveSummary["tables"] }) {
  return (
    <table className={styles.counts}>
      <CountsHead />
      <tbody>
        {tables.map((row) => (
          <tr key={row.table}>
            <td>{row.table}</td>
            <td>{row.moved}</td>
            <td>{row.keptConflict}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountsHead() {
  return (
    <thead>
      <tr>
        <th>Table</th>
        <th>Moved</th>
        <th>Kept: both hold it</th>
      </tr>
    </thead>
  );
}

/** The typed name keeps a stray click from moving anything. */
function ConfirmMove(props: {
  mirror: string;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");

  return (
    <div className={styles.confirm}>
      <ConfirmInput mirror={props.mirror} typed={typed} onType={setTyped} />
      <PendingActionButton
        action={props.onConfirm}
        text="Move now"
        pendingText="Moving the knowledge…"
        disabled={typed !== props.mirror}
        className=""
      />
    </div>
  );
}

/** The label and the box; Enter in the box must not save the settings form around it. */
function ConfirmInput(props: {
  mirror: string;
  typed: string;
  onType: (typed: string) => void;
}) {
  return (
    <>
      <label htmlFor="mirror-move-confirm">
        Type {props.mirror} to confirm
      </label>
      <input
        id="mirror-move-confirm"
        value={props.typed}
        autoComplete="off"
        onChange={(event) => props.onType(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
      />
    </>
  );
}

function Outcome({ summary }: { summary: MoveSummary }) {
  return (
    <div role="status" className={styles.note}>
      {outcomeLines(summary).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
