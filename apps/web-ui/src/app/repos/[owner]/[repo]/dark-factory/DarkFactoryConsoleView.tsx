import { Alert } from "@/components/Alert";
import Link from "next/link";
import Icon from "@/components/Icon";
import type { DarkFactoryConsoleModel } from "./derive-console";
import styles from "./DarkFactoryConsoleView.module.css";

const BADGE_CLASS: Record<string, string> = {
  active: styles.active,
  disabled: styles.disabled,
};

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type ConsoleConfig = DarkFactoryConsoleModel["config"];
type AutoMergeConfig = ConsoleConfig["auto_merge"];
type TrustLevel = DarkFactoryConsoleModel["trustLevel"];
type WorkItemList = DarkFactoryConsoleModel["workItems"];
type DecisionList = DarkFactoryConsoleModel["decisions"];

interface ConsoleViewProps {
  owner: string;
  repo: string;
  model: DarkFactoryConsoleModel;
}

export default function DarkFactoryConsoleView(props: ConsoleViewProps) {
  const { owner, repo, model } = props;
  const { activation, config, trustLevel, workItems, decisions } = model;

  return (
    <div>
      <h2>Dark Factory</h2>
      <ActivationCard
        owner={owner}
        repo={repo}
        activation={activation}
        trustLevel={trustLevel}
      />
      <AutoMergePolicy config={config} />
      <WorkItems workItems={workItems} />
      <DecisionFeed decisions={decisions} />
    </div>
  );
}

interface ActivationCardProps {
  owner: string;
  repo: string;
  activation: DarkFactoryConsoleModel["activation"];
  trustLevel: TrustLevel;
}

/** Two gates decide whether the factory runs dark on this repo: the repo's own switch and its trust level. Both are shown, because either one alone explains an "off". */
function ActivationCard(props: ActivationCardProps) {
  const { owner, repo, activation, trustLevel } = props;

  return (
    <div className="spec-card">
      <div className={styles.stateRow}>
        <span className={`${styles.badge} ${BADGE_CLASS[activation.state]}`}>
          {cap(activation.state)}
        </span>
        <span className="meta">{activation.reason}</span>
      </div>
      <Gates repoEnabled={activation.repoEnabled} trustLevel={trustLevel} />
      <TwoKeyNote owner={owner} repo={repo} />
    </div>
  );
}

interface GatesProps {
  repoEnabled: boolean;
  trustLevel: TrustLevel;
}

/** Both gates, always. Either one alone explains an "off", so showing only the failing one would leave a reader guessing whether the other is fine. */
function Gates({ repoEnabled, trustLevel }: GatesProps) {
  return (
    <div className={styles.gates}>
      <span>
        Repo gate: <RepoGate enabled={repoEnabled} />
      </span>
      <span>Trust: {trustLevel}</span>
    </div>
  );
}

/** The repo's own switch, spelled out with an icon so an "off" is legible at a glance. */
function RepoGate({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <>
      <Icon name="check" size={13} inline /> enabled
    </>
  ) : (
    <>
      <Icon name="error" size={13} inline /> disabled
    </>
  );
}

/** Says up front that this is not a switch anyone can flip. The ceremony is stated here rather than only enforced at the API, so a reader learns the cost before clicking through. */
function TwoKeyNote({ owner, repo }: { owner: string; repo: string }) {
  return (
    <p className="meta">
      Enabling/disabling and editing this policy needs the two-key approval
      ceremony —{" "}
      <Link href={`/repos/${owner}/${repo}/dark-factory/settings`}>
        Dark Factory settings
      </Link>
      .
    </p>
  );
}

function AutoMergePolicy({ config }: { config: ConsoleConfig }) {
  return (
    <>
      <h3>Auto-merge policy</h3>
      <div className="spec-card">
        <dl className={styles.config}>
          {policyRows(config).map((row) => (
            <PolicyRow key={row.label} {...row} />
          ))}
        </dl>
      </div>
    </>
  );
}

/** The policy as label/value pairs. An empty notify list reads as "escalation (implicit)" rather than blank: the platform always escalates, so nothing configured is not the same as nothing happening. */
function policyRows(config: ConsoleConfig) {
  const notify = config.notify.length
    ? config.notify.join(", ")
    : "escalation (implicit)";

  return [
    ...requirementRows(config.auto_merge),
    { label: "Create issue", value: config.create_issue },
    { label: "Review", value: config.review },
    { label: "Notify", value: notify },
  ];
}

/** The auto-merge gates, each shown as the literal value it is set to. */
function requirementRows(autoMerge: AutoMergeConfig) {
  return [
    { label: "Allowlist paths", value: autoMerge.paths.join(", ") },
    { label: "Min trust", value: autoMerge.min_trust },
    { label: "Require green CI", value: String(autoMerge.require_green_ci) },
    {
      label: "Require bot approval",
      value: String(autoMerge.require_bot_approval),
    },
  ];
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function WorkItems({ workItems }: { workItems: WorkItemList }) {
  return (
    <>
      <h3>What it works on</h3>
      {workItems.length > 0 ? (
        <WorkItemsTable workItems={workItems} />
      ) : (
        <Alert variant="secondary">No recent tasks.</Alert>
      )}
    </>
  );
}

function WorkItemsTable({ workItems }: { workItems: WorkItemList }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Status</th>
          <th>PR</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {workItems.map((workItem) => (
          <WorkItemRow key={workItem.id} workItem={workItem} />
        ))}
      </tbody>
    </table>
  );
}

/** One task the factory ran. A dash rather than a blank when there is no PR: dark mode's whole point is that the PR is the artifact, so its absence is worth showing. */
function WorkItemRow({ workItem }: { workItem: WorkItemList[number] }) {
  return (
    <tr>
      <td>{workItem.type}</td>
      <td>{workItem.status}</td>
      <td>
        {workItem.prUrl ? (
          <a href={workItem.prUrl}>PR</a>
        ) : (
          <span className="meta">—</span>
        )}
      </td>
      <td className="meta">{workItem.createdAt}</td>
    </tr>
  );
}

function DecisionFeed({ decisions }: { decisions: DecisionList }) {
  return (
    <>
      <h3>Decision feed</h3>
      {decisions.length > 0 ? (
        <DecisionItems decisions={decisions} />
      ) : (
        <Alert variant="secondary">No dark-factory audit events yet.</Alert>
      )}
    </>
  );
}

function DecisionItems({ decisions }: { decisions: DecisionList }) {
  return (
    <ul className={styles.feed}>
      {decisions.map((decision, index) => (
        <li key={`${decision.kind}-${index}`}>
          <span>{decision.summary}</span>{" "}
          <span className="meta">{decision.createdAt}</span>
        </li>
      ))}
    </ul>
  );
}
