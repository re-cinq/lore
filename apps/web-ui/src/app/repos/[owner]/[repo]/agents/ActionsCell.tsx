import Link from "next/link";
import RemoveOverrideButton from "./RemoveOverrideButton";
import styles from "./agents.module.css";

/** Drops a repo's project definition so the org-wide default resolves again. */
export type RemoveOverride = (name: string) => Promise<void>;

export interface ActionsCellProps {
  /** Edit target; null where editing is impossible, which drops the whole cell. */
  href: string | null;
  name: string;
  isProject: boolean;
  remove?: RemoveOverride;
}

/** Edit, plus Remove on a row this repo actually owns. An org default has no override to drop, so it gets no button rather than a disabled one — a dead control says less than no control. */
export default function ActionsCell({
  href,
  name,
  isProject,
  remove,
}: ActionsCellProps) {
  if (!href) {
    return null;
  }

  return (
    <td className={styles.actions}>
      <Link className="btn-secondary" href={href}>
        Edit
      </Link>
      {isProject && remove ? (
        <RemoveOverrideButton name={name} remove={remove.bind(null, name)} />
      ) : null}
    </td>
  );
}
