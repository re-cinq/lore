"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Kbd } from "@/components/shell/ShellDialog";
import { moveSelection, paletteItems, type PaletteItem } from "./palette-items";
import styles from "./CommandPalette.module.css";

const STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

const HINTS = ["↑ ↓ to move", "Enter to open", "? for shortcuts"];

/** Search or jump to: a filtered list of every destination plus a full-text search, driven from the keyboard. Escape is the shell provider's. */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const palette = usePalette(onClose);

  return (
    <PaletteFrame onClose={onClose}>
      <PaletteBody {...palette} />
    </PaletteFrame>
  );
}

/** The palette's state: the query, the highlighted row, and what picking a row does (close, then navigate). */
function usePalette(onClose: () => void): PaletteBodyProps {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = paletteItems(query);
  const onPick = (result: PaletteItem) => {
    onClose();
    router.push(result.href);
  };
  const onQuery = (q: string) => {
    setQuery(q);
    setSelected(0);
  };
  const onKeyDown = paletteKeys({ results, selected, setSelected, onPick });
  const list = { results, selected, onHover: setSelected, onPick };

  return { query, onQuery, onKeyDown, list };
}

interface PaletteKeysInput {
  results: PaletteItem[];
  selected: number;
  setSelected: React.Dispatch<React.SetStateAction<number>>;
  onPick: (result: PaletteItem) => void;
}

/** Arrows move the highlight, Enter opens it. */
function paletteKeys(input: PaletteKeysInput) {
  const { results, selected, setSelected, onPick } = input;

  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key in STEP) {
      e.preventDefault();
      setSelected((s) => moveSelection(s, STEP[e.key], results.length));

      return;
    }

    if (e.key === "Enter" && selected < results.length) {
      e.preventDefault();
      onPick(results[selected]);
    }
  };
}

interface PaletteFrameProps {
  onClose: () => void;
  children: React.ReactNode;
}

function PaletteFrame({ onClose, children }: PaletteFrameProps) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        className={styles.palette}
      >
        {children}
        <Hints />
      </div>
    </>
  );
}

function Hints() {
  return (
    <div className={styles.hints}>
      {HINTS.map((hint) => (
        <span key={hint}>{hint}</span>
      ))}
    </div>
  );
}

interface ResultListProps {
  results: PaletteItem[];
  selected: number;
  onHover: (index: number) => void;
  onPick: (result: PaletteItem) => void;
}

interface PaletteBodyProps {
  query: string;
  onQuery: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  list: ResultListProps;
}

/** The field above its results. */
function PaletteBody({ query, onQuery, onKeyDown, list }: PaletteBodyProps) {
  const listId = useId();
  const active = list.results.at(list.selected);
  const field = { query, onQuery, onKeyDown, listId };

  return (
    <>
      <PaletteField
        {...field}
        activeId={active ? `${listId}-${active.key}` : undefined}
      />
      <ResultList listId={listId} {...list} />
    </>
  );
}

interface PaletteFieldProps {
  query: string;
  onQuery: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  listId: string;
  activeId?: string;
}

/** A combobox over the result list, so a screen reader hears the highlighted row as the arrows move it. */
function PaletteField(props: PaletteFieldProps) {
  const combobox = comboboxProps(props.listId, props.activeId);

  return (
    <div className={styles.field}>
      <Icon name="search" size={20} />
      <input
        autoFocus
        {...combobox}
        placeholder="Jump to a page, or type to search…"
        value={props.query}
        onChange={(e) => props.onQuery(e.target.value)}
        onKeyDown={props.onKeyDown}
        className={styles.input}
      />
      <Kbd>esc</Kbd>
    </div>
  );
}

function ResultList(props: ResultListProps & { listId: string }) {
  const { listId, results } = props;

  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Results"
      className={styles.results}
    >
      {results.map((result, i) => (
        <ResultRow key={result.key} {...rowProps(props, result, i)} />
      ))}
    </ul>
  );
}

/** One row's props: its option id, whether it is highlighted, and what hovering or picking it does. */
function rowProps(
  props: ResultListProps & { listId: string },
  result: PaletteItem,
  i: number,
): ResultRowProps {
  return {
    id: `${props.listId}-${result.key}`,
    result,
    selected: i === props.selected,
    onHover: () => props.onHover(i),
    onPick: () => props.onPick(result),
  };
}

interface ResultRowProps {
  id: string;
  result: PaletteItem;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}

/** One destination: its mono group caption, then its name. */
function ResultRow({ id, result, selected, onHover, onPick }: ResultRowProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      className={styles.result}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <span className={styles.group}>{result.group}</span>
      <span className={styles.label}>{result.label}</span>
    </li>
  );
}

/** The input's combobox wiring: the list it controls and the row it points at. */
function comboboxProps(listId: string, activeId?: string) {
  return {
    role: "combobox",
    "aria-expanded": true,
    "aria-controls": listId,
    "aria-activedescendant": activeId,
    "aria-label": "Search or jump to",
  };
}
