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

/** The three things a reader most often gets wrong about this page. */
function SettingsHelpPoints() {
  return (
    <ul>
      <li>
        <strong>Trust level</strong> controls which task types are allowed, and
        auto-promotes after 3 successful merges.
      </li>
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
