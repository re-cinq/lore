import { FormError } from "@/components/FormError";
import styles from "./PlanRunError.module.scss";

/** In place of the run card and the editor when the plan's run could not be loaded: the editor stays closed, since the page cannot tell whether a draft is being written (specs/plan-detail-fast-open FR9). */
export default function PlanRunError({ retry }: { retry: () => void }) {
  return (
    <div className={styles.runError}>
      <FormError message="Couldn't load the planning run." />
      <button type="button" className="btn-secondary" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
