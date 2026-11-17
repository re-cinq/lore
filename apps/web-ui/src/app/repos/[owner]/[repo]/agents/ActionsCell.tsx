import EditLink from "@/components/EditLink";
import RemoveOverrideButton from "./RemoveOverrideButton";
import styles from "./agents.module.css";

/** Drops a repo's project definition so the org-wide default resolves again. */
export type RemoveOverride = (name: string) => Promise<void>;

export interface ActionsCellProps {
  /** Edit target; null where editing is impossible, which drops the whole cell. */
  href: string | null;
  name: string;
  isProject: boolean;
  /** The client's pack owns this org default: its cell says so instead of offering Edit. */
  packManaged?: boolean;
  remove?: RemoveOverride;
}

/** Edit, plus Remove on a row this repo actually owns. An org default has no override to drop, so it gets no button rather than a disabled one — a dead control says less than no control. */
export default function ActionsCell(props: ActionsCellProps) {
  if (!props.href) {
    return null;
  }

  return (
    <td className={styles.actions}>
      {props.packManaged ? (
        "Managed by pack"
      ) : (
        <EditActions {...props} href={props.href} />
      )}
    </td>
  );
}

function EditActions({
  href,
  name,
  isProject,
  remove,
}: ActionsCellProps & { href: string }) {
  return (
    <>
      <EditLink className="btn-secondary" href={href} />
      {isProject && remove ? (
        <RemoveOverrideButton name={name} remove={remove.bind(null, name)} />
      ) : null}
    </>
  );
}
