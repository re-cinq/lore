// What the enrollment checks mean, as popover copy — split out of EnrollmentSection so the section file stays about the checks themselves.
import HelpPopover from "./HelpPopover";

function RepoIntegrationPoint() {
  return (
    <li>
      <strong>Repo integration</strong> is verified from Lore&apos;s database
      and (where the GitHub App has access) the repo&apos;s files. A missing
      file (e.g. the <code>lore-ingest.yml</code> ingest workflow) can be fixed
      in place — the <em>create a PR with this file</em> action queues an
      onboarding task that opens a PR adding only what&apos;s missing.
    </li>
  );
}

function McpUsagePoint() {
  return (
    <li>
      <strong>Used locally via MCP</strong> turns green once a Claude Code
      session for this repo is recorded.
    </li>
  );
}

function LocalSetupPoint() {
  return (
    <li>
      The <strong>local setup</strong> steps run on your machine and can&apos;t
      be auto-verified.
    </li>
  );
}

function EnrollmentHelpPoints() {
  return (
    <ul>
      <RepoIntegrationPoint />
      <McpUsagePoint />
      <LocalSetupPoint />
    </ul>
  );
}

export default function EnrollmentHelp() {
  return (
    <HelpPopover label="What enrollment checks mean">
      <p>
        These checks show whether this repo is wired into Lore and whether
        you&apos;ve set it up locally.
      </p>
      <EnrollmentHelpPoints />
    </HelpPopover>
  );
}
