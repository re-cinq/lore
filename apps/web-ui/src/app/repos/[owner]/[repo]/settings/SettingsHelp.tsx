import HelpPopover from "@/components/HelpPopover";

/** The popover beside the tab title: how repo settings apply over the org defaults. */
export default function SettingsHelp() {
  return (
    <HelpPopover label="How settings are applied">
      <p>
        Per-repo configuration, applied over the org-wide defaults — repo values
        win.
      </p>
      <SettingsHelpPoints />
    </HelpPopover>
  );
}

/** The things a reader most often gets wrong about this page. */
function SettingsHelpPoints() {
  return (
    <ul>
      <li>
        <strong>Trust level</strong> controls which task types are allowed, and
        auto-promotes after 3 successful merges.
      </li>
      <DoneCheckHelpPoint />
      <li>
        <strong>Cross-repo</strong> links are bidirectional — adding a repo here
        adds this repo to theirs.
      </li>
      <li>
        Per-repo <strong>agents</strong> live on the <strong>Agents</strong>{" "}
        tab.
      </li>
    </ul>
  );
}

function DoneCheckHelpPoint() {
  return (
    <li>
      <strong>Done check</strong> lets the implementation loop close a ticket a
      merged pull request already did, before its costliest agent runs. It is
      off until ticked here.
    </li>
  );
}
