import type { StepEvent } from "./steps.ts";
import type { ServiceSpec } from "./services.ts";

const ANSI = { green: 32, red: 31, yellow: 33, dim: 2 } as const;

export function paint(
  text: string,
  color: keyof typeof ANSI,
  enabled: boolean,
): string {
  return enabled ? `\u001b[${ANSI[color]}m${text}\u001b[0m` : text;
}

export function formatStepEvent(event: StepEvent, color: boolean): string[] {
  switch (event.type) {
    case "running":
      return [];
    case "done": {
      const note = event.note ? ` (${event.note})` : "";
      const elapsed =
        event.seconds >= 1 ? `  ${event.seconds.toFixed(1)}s` : "";

      return [
        `[lore] ${paint("✔", "green", color)} ${event.title}${note}${elapsed}`,
      ];
    }
    case "warning":
      return [`[lore] ${paint("!", "yellow", color)} ${event.text}`];
    case "failed": {
      const exit = event.code === null ? "did not run" : `exit ${event.code}`;

      return [
        `[lore] ${paint("✖", "red", color)} ${event.title}   (${exit}, ${event.seconds.toFixed(1)}s)`,
        ...(event.tail.length > 0 ? ["[lore]   -- last output --"] : []),
        ...event.tail.map((line) => `[lore]   ${line}`),
        ...(event.fix ? ["[lore]   -- fix --", `[lore]   ${event.fix}`] : []),
      ];
    }
  }
}

export function formatTable(specs: ServiceSpec[]): string[] {
  const widthOf = (pick: (spec: ServiceSpec) => string): number =>
    Math.max(...specs.map((spec) => pick(spec).length));
  const nameWidth = widthOf((spec) => spec.name);
  const whereWidth = widthOf((spec) => spec.where);

  return specs.map((spec) => {
    return `[lore] ${spec.name.padEnd(nameWidth)}  ${spec.where.padEnd(whereWidth)}  ${spec.role}`;
  });
}

export function prefixLine(service: string, text: string): string {
  return `[${service}] ${text}`;
}
