import { Fragment, type ReactNode } from "react";
import { modelVendor } from "@/lib/model-vendor";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentPresence,
  AgentUsage,
  DefinitionActivity,
} from "@/lib/agents-api";
import { SettingsCard } from "@/components/SettingsCard";
import EditLink from "@/components/EditLink";
import { ScopePill } from "../repos/[owner]/[repo]/agents/AgentList";
import { rowCells } from "../repos/[owner]/[repo]/agents/agent-row-cells";
import {
  agentTitles,
  groupAgentsByLine,
  lineTitle,
  type LineGroup,
} from "./group-by-line";
import { activityLine } from "./activity-line";
import PresenceDot from "./PresenceDot";
import styles from "./page.module.css";

/** What the cards read beside the definitions; each part is null when its endpoint could not answer. */
export interface Catalog {
  usage: AgentUsage | null;
  activity: Partial<Record<string, DefinitionActivity>> | null;
  presence: Partial<Record<string, AgentPresence>> | null;
}

interface AgentCardsProps {
  agents: AgentDefinition[];
  catalog: Catalog;
}

/** The org catalog as one section per assembly line, one card per agent. */
export default function AgentCards({ agents, catalog }: AgentCardsProps) {
  return groupAgentsByLine(agents, catalog.usage).map((group) => (
    <LineSection key={group.line} {...group} catalog={catalog} />
  ));
}

type LineSectionProps = LineGroup & { catalog: Catalog };

function LineSection({ line, agents, catalog }: LineSectionProps) {
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
            catalog={catalog}
          />
        ))}
      </div>
    </section>
  );
}

interface AgentCardProps {
  agent: AgentDefinition;
  catalog: Catalog;
}

function AgentCard({
  agent,
  title,
  catalog,
}: AgentCardProps & { title: string }) {
  return (
    <div className={styles.agentCard} data-vendor={modelVendor(agent.model)}>
      <SettingsCard
        id={`agent-${agent.name}`}
        title={<CardTitle title={title} {...{ agent, catalog }} />}
        description={rowCells(agent, catalog.usage).use.text}
        headingLevel={3}
      >
        <AgentFacts agent={agent} catalog={catalog} />
        <EditAction href={`/agents/edit/${encodeURIComponent(agent.name)}`} />
      </SettingsCard>
    </div>
  );
}

function CardTitle({
  title,
  agent,
  catalog,
}: AgentCardProps & { title: string }) {
  const presence = catalog.presence?.[agent.name];

  return (
    <>
      {title}
      {presence && <PresenceDot presence={presence} />}
    </>
  );
}

function AgentFacts({ agent, catalog }: AgentCardProps) {
  const facts: Array<[string, ReactNode]> = [
    ["Name", agent.name],
    ["Scope", <ScopePill key="scope" isProject={Boolean(agent.project_id)} />],
    ["Model", agent.model ?? "(inherit)"],
    ["Timeout", `${agent.timeout_minutes ?? "–"}m`],
    ["Mode", rowCells(agent, catalog.usage).mode],
    ["Last 30 days", activityLine(catalog.activity, agent.name)],
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

function EditAction({ href }: { href: string }) {
  return (
    <div className={styles.edit}>
      <EditLink href={href} />
    </div>
  );
}
