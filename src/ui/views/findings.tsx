import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/use-theme";
import { EmptyState, ErrorLine, ViewHeader, Well } from "@/ui/chrome";
import {
  FindingList,
  type FindingRow,
} from "@/ui/views/finding-list";

export type { FindingRow };
export { SAMPLE_FINDINGS } from "@/ui/views/finding-list";

export interface FindingsViewProps {
  findings?: FindingRow[];
  loading?: boolean;
  error?: string;
  selected?: number;
  detail?: string;
}

export const FindingsView = ({
  findings = [],
  loading = false,
  error,
  selected,
  detail,
}: FindingsViewProps) => {
  const theme = useTheme();
  const rows = findings;
  const selectedRow =
    selected !== undefined ? rows[selected] : undefined;
  const detailText = detail ?? selectedRow?.description;

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader kicker="findings" title="What landed after merge" />
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {loading ? (
        <box marginTop={1}>
          <Spinner
            type="line"
            label="loading"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : rows.length === 0 ? (
        <EmptyState>run a scan first — s on the scan view</EmptyState>
      ) : (
        <box marginTop={1} flexGrow={1} flexDirection="column" gap={1}>
          <FindingList findings={rows} selected={selected} />
          {selectedRow ? (
            <Well bordered>
              <text fg={theme.colors.foreground}>{detailText ?? ""}</text>
            </Well>
          ) : null}
        </box>
      )}
    </box>
  );
};
