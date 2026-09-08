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

export default function DarkFactoryConsoleView({
  owner,
  repo,
  model,
}: {
  owner: string;
  repo: string;
  model: DarkFactoryConsoleModel;
}) {
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

/** Both gates, always. Either one alone explains an "off", so showing only the failing one would leave a reader guessing whether the other is fine. */
function Gates({
  repoEnabled,
  trustLevel,
}: {
  repoEnabled: boolean;
  trustLevel: DarkFactoryConsoleModel["trustLevel"];
}) {
  return (
    <div className={styles.gates}>
      <span>
        Repo gate:{" "}
        {repoEnabled ? (
          <>
            <Icon name="check" size={13} inline /> enabled
          </>
        ) : (
          <>
            <Icon name="error" size={13} inline /> disabled
          </>
        )}
      </span>
      <span>Trust: {trustLevel}</span>
    </div>
  );
}

/** Two gates decide whether the factory runs dark on this repo: the repo's own switch and its trust level. Both are shown, because either one alone explains an "off". */
function ActivationCard({
  owner,
  repo,
  activation,
  trustLevel,
}: {
  owner: string;
  repo: string;
  activation: DarkFactoryConsoleModel["activation"];
  trustLevel: DarkFactoryConsoleModel["trustLevel"];
}) {
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

/** The policy as label/value pairs. An empty notify list reads as "escalation (implicit)" rather than blank: the platform always escalates, so nothing configured is not the same as nothing happening. */
function policyRows(config: DarkFactoryConsoleModel["config"]) {
  const { auto_merge: autoMerge } = config;

  return [
    { label: "Allowlist paths", value: autoMerge.paths.join(", ") },
    { label: "Min trust", value: config.auto_merge.min_trust },
    {
      label: "Require green CI",
      value: String(config.auto_merge.require_green_ci),
    },
    {
      label: "Require bot approval",
      value: String(config.auto_merge.require_bot_approval),
    },
    { label: "Create issue", value: config.create_issue },
    { label: "Review", value: config.review },
    {
      label: "Notify",
      value: config.notify.length
        ? config.notify.join(", ")
        : "escalation (implicit)",
    },
  ];
}

function AutoMergePolicy({
  config,
}: {
  config: DarkFactoryConsoleModel["config"];
}) {
  return (
    <>
      <h3>Auto-merge policy</h3>
      <div className="spec-card">
        <dl className={styles.config}>
          {policyRows(config).map(({ label, value }) => (
            <div key={label}>
              <dt className="meta">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

/** One task the factory ran. A dash rather than a blank when there is no PR: dark mode's whole point is that the PR is the artifact, so its absence is worth showing. */
function WorkItemRow({
  workItem,
}: {
  workItem: DarkFactoryConsoleModel["workItems"][number];
}) {
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

function WorkItems({
  workItems,
}: {
  workItems: DarkFactoryConsoleModel["workItems"];
}) {
  return (
    <>
      <h3>What it works on</h3>
      {workItems.length > 0 ? (
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
      ) : (
        <Alert variant="secondary">No recent tasks.</Alert>
      )}
    </>
  );
}

function DecisionFeed({
  decisions,
}: {
  decisions: DarkFactoryConsoleModel["decisions"];
}) {
  return (
    <>
      <h3>Decision feed</h3>
      {decisions.length > 0 ? (
        <ul className={styles.feed}>
          {decisions.map((decision, index) => (
            <li key={`${decision.kind}-${index}`}>
              <span>{decision.summary}</span>{" "}
              <span className="meta">{decision.createdAt}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Alert variant="secondary">No dark-factory audit events yet.</Alert>
      )}
    </>
  );
}
