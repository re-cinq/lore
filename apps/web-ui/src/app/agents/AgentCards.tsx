import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage } from "@/lib/agents-api";
import { SettingsCard } from "@/components/SettingsCard";
import { ScopePill } from "../repos/[owner]/[repo]/agents/AgentList";
import { rowCells } from "../repos/[owner]/[repo]/agents/agent-row-cells";
import {
  agentTitles,
  groupAgentsByLine,
  lineTitle,
  type LineGroup,
} from "./group-by-line";
import styles from "./page.module.css";

interface AgentCardsProps {
  agents: AgentDefinition[];
  usage: AgentUsage | null;
}

/** The org catalog as one section per assembly line, one card per agent. */
export default function AgentCards({ agents, usage }: AgentCardsProps) {
  return groupAgentsByLine(agents, usage).map((group) => (
    <LineSection key={group.line} {...group} usage={usage} />
  ));
}

type LineSectionProps = LineGroup & { usage: AgentUsage | null };

function LineSection({ line, agents, usage }: LineSectionProps) {
  const titles = agentTitles(agents.map((agent) => agent.name));

  return (
    <section className={styles.line}>
      <h3>{lineTitle(line)}</h3>
      <div className={styles.cards}>
        {agents.map((agent, index) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            title={titles[index]}
            usage={usage}
          />
        ))}
      </div>
    </section>
  );
}

interface AgentCardProps {
  agent: AgentDefinition;
  usage: AgentUsage | null;
}

function AgentCard({
  agent,
  title,
  usage,
}: AgentCardProps & { title: string }) {
  const editHref = `/agents/edit/${encodeURIComponent(agent.name)}`;

  return (
    <SettingsCard
      id={`agent-${agent.name}`}
      title={title}
      description={rowCells(agent, usage).use.text}
      headingLevel={3}
    >
      <AgentFacts agent={agent} usage={usage} />
      <Link className={`btn-secondary ${styles.edit}`} href={editHref}>
        Edit
      </Link>
    </SettingsCard>
  );
}

function AgentFacts({ agent, usage }: AgentCardProps) {
  const isProject = agent.project_id != null && agent.project_id !== "";
  const facts: Array<[string, ReactNode]> = [
    ["Name", agent.name],
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
