import { TEST_COMMAND_SETUP_PROMPT } from '@/lib/test-command-setup-prompt';
import CopyButton from '@/components/CopyButton';
import styles from './TestCommandsSetup.module.css';

/**
 * Presentational view for the test-command setup prompt. Pure render — the
 * prompt text is a static constant fed verbatim into a wrapping `<pre>`, no
 * data access or state. Mirrors the colocated-CSS-module convention of its
 * sibling spec components (`SpecCard`, `RepoSpecsView`).
 */
export default function TestCommandsSetup() {
  return (
    <div className={styles.block}>
      <h2 className={styles.heading}>Set up test commands</h2>
      <p className="meta">
        Copy this prompt and run it with Claude in your repo to generate <code>.lore/test-commands.yml</code>.
      </p>
      <CopyButton text={TEST_COMMAND_SETUP_PROMPT} />
      <pre className={styles.prompt}>{TEST_COMMAND_SETUP_PROMPT}</pre>
    </div>
  );
}
