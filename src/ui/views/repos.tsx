import { Spinner } from "@/components/ui/spinner";
import { Table } from "@/components/ui/table";
import { useTheme } from "@/hooks/use-theme";
import { EmptyState, ErrorLine, ViewHeader } from "@/ui/chrome";

export interface RepoRow {
  readonly id: string | number;
  readonly owner: string;
  readonly name: string;
}

export interface ReposViewProps {
  repos?: RepoRow[];
  loading?: boolean;
  error?: string;
  hint?: string;
}

export const SAMPLE_REPOS: RepoRow[] = [
  { id: "repo_01", owner: "acme", name: "payments-api" },
  { id: "repo_02", owner: "acme", name: "web" },
];

export const ReposView = ({
  repos = [],
  loading = false,
  error,
  hint,
}: ReposViewProps) => {
  const theme = useTheme();

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader kicker="repos" title="Connected repositories" />
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {loading ? (
        <box marginTop={1}>
          <Spinner
            type="line"
            label="loading"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : repos.length === 0 ? (
        <EmptyState>connect a repository, or scan this one first</EmptyState>
      ) : (
        <box marginTop={1} flexGrow={1}>
          <Table
            data={repos.map((r) => ({
              owner: r.owner,
              name: r.name,
              id: r.id,
            }))}
            columns={[
              { key: "owner", header: "owner", width: 16 },
              { key: "name", header: "name", width: 24 },
              { key: "id", header: "id", width: 16 },
            ]}
            maxRows={14}
          />
        </box>
      )}
      {hint && (loading || repos.length === 0) ? (
        <box flexGrow={1} />
      ) : null}
      {hint ? (
        <box flexShrink={0}>
          <text fg={theme.colors.mutedForeground}>{hint}</text>
        </box>
      ) : null}
    </box>
  );
};
