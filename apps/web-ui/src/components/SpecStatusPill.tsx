import {
  SPEC_STATUS_COLOR,
  SPEC_STATUS_LABEL,
  type SpecStatus,
} from "@/lib/spec-status";

export default function SpecStatusPill({ status }: { status: SpecStatus }) {
  return (
    <span
      className="status-pill"
      style={{ ["--pill-color" as string]: SPEC_STATUS_COLOR[status] }}
    >
      {SPEC_STATUS_LABEL[status]}
    </span>
  );
}
