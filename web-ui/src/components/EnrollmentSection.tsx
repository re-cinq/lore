import { type Check, type CheckStatus, passSummary } from '@/lib/enrollment';
import HelpPopover from './HelpPopover';
import CopyButton from './CopyButton';

const STATUS: Record<CheckStatus, { icon: string; color: string }> = {
  pass: { icon: '✓', color: '#3fb950' },
  warn: { icon: '⚠', color: '#d29922' },
  fail: { icon: '✗', color: '#f85149' },
  unknown: { icon: '–', color: '#6e7681' },
};

function CheckRow({ check }: { check: Check }) {
  const s = STATUS[check.status];
  return (
    <div className="enroll-row">
      <span aria-hidden style={{ color: s.color, fontWeight: 700, width: '1em', flexShrink: 0 }}>{s.icon}</span>
      <span style={{ flexShrink: 0 }}>{check.label}</span>
      <span className="enroll-dots" />
      {check.detail && <span className="meta" style={{ fontSize: '12px' }}>{check.detail}</span>}
      {check.link && (
        <a href={check.link.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
          {check.link.text}
        </a>
      )}
    </div>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <pre style={{ flex: 1, margin: 0 }}>{command}</pre>
      <CopyButton text={command} />
    </div>
  );
}

function Step({
  label,
  note,
  command,
  alt,
}: {
  label: string;
  note?: string;
  command: string;
  alt?: { label: string; command: string };
}) {
  return (
    <li style={{ marginBottom: '14px' }}>
      <div style={{ marginBottom: '2px' }}>{label}</div>
      {note && (
        <div className="meta" style={{ fontSize: '12px', marginBottom: '6px' }}>{note}</div>
      )}
      <CommandRow command={command} />
      {alt && (
        <>
          <div className="meta" style={{ fontSize: '12px', margin: '6px 0 4px' }}>{alt.label}</div>
          <CommandRow command={alt.command} />
        </>
      )}
    </li>
  );
}

const INSTALL_CMD = 'git clone git@github.com:re-cinq/lore.git && cd lore && scripts/install.sh';
const CURL_CMD = 'curl -fsSL https://raw.githubusercontent.com/re-cinq/lore/main/scripts/install.sh | bash';

export default function EnrollmentSection({ checks }: { checks: Check[] }) {
  const { passed, total } = passSummary(checks);

  return (
    <div className="spec-card" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Enrollment</h3>
        <HelpPopover label="What enrollment checks mean">
          <p>These checks show whether this repo is wired into Lore and whether you&apos;ve set it up locally.</p>
          <ul>
            <li><strong>Repo integration</strong> is verified from Lore&apos;s database and (where the GitHub App has access) the repo&apos;s files.</li>
            <li><strong>Used locally via MCP</strong> turns green once a Claude Code session for this repo is recorded.</li>
            <li>The <strong>local setup</strong> steps run on your machine and can&apos;t be auto-verified.</li>
          </ul>
        </HelpPopover>
        <span className="meta" style={{ marginLeft: 'auto', fontSize: '12px' }}>{passed}/{total} checks passing</span>
      </div>

      <div className="meta" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Repo integration
      </div>
      <div style={{ marginBottom: '20px' }}>
        {checks.map(c => <CheckRow key={c.id} check={c} />)}
      </div>

      <div className="meta" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Your local setup
      </div>
      <ol style={{ paddingLeft: '1.4em', margin: 0 }}>
        <Step
          label="Install Lore (once per machine) — configures the MCP server, skills, hooks, statusline, and agent ID."
          note="Needs git, Node.js ≥18, and the Claude Code CLI. Clones into ~/.re-cinq/lore, builds the MCP server, and registers it in your Claude config. Idempotent — safe to re-run."
          command={INSTALL_CMD}
          alt={{ label: '…or without cloning (private repo needs SSH/token access):', command: CURL_CMD }}
        />
        <Step label="Open this repo and start Claude Code — org context loads automatically." command="claude" />
        <Step label="Verify context loads." command={'claude "how do we handle auth in this repo?"'} />
      </ol>
      <p className="meta" style={{ fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
        These run on your machine and aren&apos;t auto-verified — completing step 2 flips <strong>Used locally via MCP</strong> green once a session summary is recorded.
      </p>
    </div>
  );
}
