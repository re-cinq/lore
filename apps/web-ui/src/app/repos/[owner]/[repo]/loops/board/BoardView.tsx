import Link from "next/link";
import { Alert } from "@/components/Alert";
import MiniPipeline from "@/components/MiniPipeline";
import Panel from "@/components/Panel";
import LoopTable, { ActionsCell, StatusCell } from "../LoopTable";
import type { Board, BoardRow, BoardSection } from "./board";
import RowSubjectCell from "./RowSubjectCell";
import LinkPending from "../LinkPending";
import styles from "./BoardView.module.scss";

interface BoardViewProps {
  board: Board;
  /** The subject column's heading: Ticket, Pull request, Issue, or Work for every loop. */
  subject: string;
  /** Name each row's loop: on when the board shows more than one. */
  showLoop: boolean;
  /** The address of the same view with one more page of a section. */
  loadMore: (key: BoardSection["key"]) => string;
}

/** Pure view (DDAU) of the board: a loop that could not be read, then one panel per shared section. */
export default function BoardView({ board, ...columns }: BoardViewProps) {
  return (
    <div className={styles.sections}>
      <Failures failures={board.failures} />
      {board.sections.map((section) => (
        <SectionPanel key={section.key} section={section} {...columns} />
      ))}
    </div>
  );
}

function Failures({ failures }: { failures: readonly string[] }) {
  return failures.map((failure) => (
    <Alert key={failure} variant="secondary">
      {failure}
    </Alert>
  ));
}

type SectionPanelProps = Omit<BoardViewProps, "board"> & {
  section: BoardSection;
};

function SectionPanel({ section, loadMore, ...table }: SectionPanelProps) {
  return (
    <Panel title={section.heading}>
      <SectionNotices notices={section.notices} />
      <SectionTable section={section} {...table} />
      {section.hasMore && <LoadMore href={loadMore(section.key)} />}
    </Panel>
  );
}

function SectionTable({
  section,
  subject,
  showLoop,
}: Omit<SectionPanelProps, "loadMore">) {
  return (
    <LoopTable
      subject={subject}
      emptyText={section.emptyText}
      testId="board-table"
      rows={section.rows.map((row, i) => (
        <BoardRowView
          key={`${row.loop.key}-${row.ref}-${i}`}
          row={row}
          showLoop={showLoop}
        />
      ))}
    />
  );
}

/** Five more rows of the section, by address, so a live refresh keeps them; the page under it stays while they load. */
function LoadMore({ href }: { href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`btn btn-secondary ${styles.loadMore}`}
      data-testid="load-more"
    >
      Load more
      <LinkPending />
    </Link>
  );
}

/** What holds every row of a section alike, said once above them. */
function SectionNotices({ notices }: { notices: readonly string[] }) {
  return notices.map((notice) => (
    <p
      key={notice}
      className={`meta ${styles.sectionNotice}`}
      data-testid="section-notice"
    >
      {notice}
    </p>
  ));
}

function BoardRowView({ row, showLoop }: { row: BoardRow; showLoop: boolean }) {
  return (
    <tr data-testid="board-row">
      <StatusCell state={row.state} since={row.since} />
      <RowSubjectCell row={row} showLoop={showLoop} />
      <td>
        {row.pipeline && row.runId && (
          <MiniPipeline runId={row.runId} pipeline={row.pipeline} />
        )}
      </td>
      <ActionsCell runId={row.runId} external={pullLink(row)} />
    </tr>
  );
}

function pullLink(row: BoardRow) {
  return row.prUrl ? { href: row.prUrl, text: "PR" } : null;
}
