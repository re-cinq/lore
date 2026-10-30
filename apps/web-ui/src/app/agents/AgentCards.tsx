import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage } from "@/lib/agents-api";
import { SettingsCard } from "@/components/SettingsCard";
import { ScopePill } from "../repos/[owner]/[repo]/agents/AgentList";
import { rowCells } from "../repos/[owner]/[repo]/agents/agent-row-cells";
import { groupAgentsByLine } from "./group-by-line";
import styles from "./page.module.css";

interface AgentCardsProps {
  agents: AgentDefinition[];
  usage: AgentUsage | null;
}

/** The org catalog as one section per assembly line, one card per agent. */
export default function AgentCards({ agents, usage }: AgentCardsProps) {
  return groupAgentsByLine(agents, usage).map(
    ({ line, agents: lineAgents }) => (
      <section key={line} className={styles.line}>
        <h3>{line}</h3>
        <div className={styles.cards}>
          {lineAgents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} usage={usage} />
          ))}
        </div>
      </section>
    ),
  );
}

interface AgentCardProps {
  agent: AgentDefinition;
  usage: AgentUsage | null;
}

function AgentCard({ agent, usage }: AgentCardProps) {
  const editHref = `/agents/edit/${encodeURIComponent(agent.name)}`;

  return (
    <SettingsCard
      id={`agent-${agent.name}`}
      title={agent.name}
      description={rowCells(agent, usage).use.text}
      headingLevel={3}
      action={<Link href={editHref}>Edit</Link>}
    >
      <AgentFacts agent={agent} usage={usage} />
    </SettingsCard>
  );
}

function AgentFacts({ agent, usage }: AgentCardProps) {
  const isProject = agent.project_id != null && agent.project_id !== "";
  const facts: Array<[string, ReactNode]> = [
    ["Scope", <ScopePill key="scope" isProject={isProject} />],
    ["Model", agent.model ?? "(inherit)"],
    ["Timeout", `${agent.timeout_minutes ?? "–"}m`],
    ["Mode", rowCells(agent, usage).mode],
  ];

  return (
    <dl className={styles.facts}>
      {facts.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
