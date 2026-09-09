import { TEST_COMMAND_SETUP_PROMPT } from "@/lib/test-command-setup-prompt";
import CollapsibleCard from "@/components/CollapsibleCard";
import CopyButton from "@/components/CopyButton";
import styles from "./TestCommandsSetup.module.css";

/** Setup prompt to wire repo's tests into traceability graph; folded closed by default. */
export default function TestCommandsSetup() {
  return (
    <CollapsibleCard title="Set up test commands">
      <p className="meta">
        Copy this prompt and run it with Claude in your repo to generate{" "}
        <code>.lore/test-commands.yml</code>.
      </p>
      <div className={styles.block}>
        <CopyButton text={TEST_COMMAND_SETUP_PROMPT} />
        <pre className={styles.prompt}>{TEST_COMMAND_SETUP_PROMPT}</pre>
      </div>
    </CollapsibleCard>
  );
}
