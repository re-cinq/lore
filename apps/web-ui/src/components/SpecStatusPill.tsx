import { SPEC_STATUS_COLOR, type SpecStatusInfo } from "@/lib/spec-status";

export default function SpecStatusPill({ info }: { info: SpecStatusInfo }) {
  return (
    <span
      className="status-pill"
      style={{ ["--pill-color" as string]: SPEC_STATUS_COLOR[info.status] }}
    >
      {info.label}
    </span>
  );
}
