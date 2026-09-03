import { SPEC_STATUS_COLOR, type SpecStatusInfo } from "@/lib/spec-status";

export default function SpecStatusPill({ status }: { status: SpecStatusInfo }) {
  return (
    <span
      className="status-pill"
      style={{ ["--pill-color" as string]: SPEC_STATUS_COLOR[status.status] }}
    >
      {status.label}
    </span>
  );
}
