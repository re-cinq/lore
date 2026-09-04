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
      <div className={styles.gates}>
        <span>
          Repo gate:{" "}
          {activation.repoEnabled ? (
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
      <p className="meta">
        Enabling/disabling and editing this policy needs the two-key approval
        ceremony —{" "}
        <Link href={`/repos/${owner}/${repo}/dark-factory/settings`}>
          Dark Factory settings
        </Link>
        .
      </p>
    </div>
  );
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
          <div>
            <dt className="meta">Allowlist paths</dt>
            <dd>{config.auto_merge.paths.join(", ")}</dd>
          </div>
          <div>
            <dt className="meta">Min trust</dt>
            <dd>{config.auto_merge.min_trust}</dd>
          </div>
          <div>
            <dt className="meta">Require green CI</dt>
            <dd>{String(config.auto_merge.require_green_ci)}</dd>
          </div>
          <div>
            <dt className="meta">Require bot approval</dt>
            <dd>{String(config.auto_merge.require_bot_approval)}</dd>
          </div>
          <div>
            <dt className="meta">Create issue</dt>
            <dd>{config.create_issue}</dd>
          </div>
          <div>
            <dt className="meta">Review</dt>
            <dd>{config.review}</dd>
          </div>
          <div>
            <dt className="meta">Notify</dt>
            <dd>
              {config.notify.length
                ? config.notify.join(", ")
                : "escalation (implicit)"}
            </dd>
          </div>
        </dl>
      </div>
    </>
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
              <tr key={workItem.id}>
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
