import Link from "next/link";
import Icon from "@/components/Icon";
import { formatEnumLabel } from "@/lib/enum-label";
import { auditUrl } from "./audit-url";
import styles from "./AuditView.module.css";

interface AuditFiltersProps {
  agent?: string | null;
  op?: string | null;
  operations: string[];
}

/** The agent search, then one chip per operation. Both are plain GET navigation: the page is server-rendered and a filtered view is a shareable URL. */
export function AuditFilters({ agent, op, operations }: AuditFiltersProps) {
  return (
    <div className={styles.filters}>
      <AgentSearch agent={agent} op={op} />
      <OperationChips agent={agent} op={op} operations={operations} />
    </div>
  );
}

function AgentSearch({ agent, op }: Omit<AuditFiltersProps, "operations">) {
  return (
    <form method="get" className={styles.search} role="search">
      <Icon name="search" size={16} className={styles.searchIcon} />
      <input
        type="text"
        name="agent"
        aria-label="Filter by agent ID"
        defaultValue={agent || ""}
        placeholder="Filter by agent ID…"
        className={styles.searchInput}
      />
      {op ? <input type="hidden" name="op" value={op} /> : null}
      {/* eslint-disable-next-line no-restricted-syntax -- native GET filter form, no mutation, no client JS state to show */}
      <button type="submit" className={styles.searchSubmit}>
        Filter
      </button>
    </form>
  );
}

/** "All" first, then every operation the trail records. The chip for the operation in view reads as the current one; picking a chip starts again at the first page. */
function OperationChips({ agent, op, operations }: AuditFiltersProps) {
  const chips = [{ key: "", label: "All" }].concat(
    operations.map((o) => ({ key: o, label: formatEnumLabel(o) })),
  );

  return (
    <nav className={styles.chips} aria-label="Operation">
      {chips.map((chip) => (
        <Link
          key={chip.key || "all"}
          href={auditUrl({ agent, op: chip.key, offset: 0 })}
          className={styles.chip}
          aria-current={(op || "") === chip.key ? "page" : undefined}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  );
}
