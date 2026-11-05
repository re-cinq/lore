import SharedLinkPending, {
  PendingMark as Mark,
} from "@/components/LinkPending";
import styles from "./LoopPicker.module.scss";

/** Inside a pill's Link: the shared pending spinner, set flush against the pill's label. */
export default function LinkPending() {
  return <SharedLinkPending className={styles.pending} />;
}

export function PendingMark({ pending }: { pending: boolean }) {
  return <Mark pending={pending} className={styles.pending} />;
}
