import type { ReactNode } from "react";

import { useTheme } from "@/hooks/use-theme";

export const ViewHeader = ({
  kicker,
  title,
}: {
  kicker?: string;
  title: string;
}) => {
  const theme = useTheme();

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      {kicker ? (
        <text fg={theme.colors.mutedForeground}>{kicker}</text>
      ) : null}
      <text fg={theme.colors.foreground}>{title}</text>
    </box>
  );
};

export const EmptyState = ({ children }: { children: string }) => {
  const theme = useTheme();

  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={theme.colors.mutedForeground}>{children}</text>
    </box>
  );
};

export const ErrorLine = ({ children }: { children: string }) => {
  const theme = useTheme();

  return <text fg={theme.colors.error}>{children}</text>;
};

export const StatusLine = ({
  tone = "muted",
  label,
}: {
  tone?: "muted" | "info" | "ok" | "warn" | "danger";
  label: string;
}) => {
  const theme = useTheme();
  const color =
    tone === "info"
      ? theme.colors.info
      : tone === "ok"
        ? theme.colors.success
        : tone === "warn"
          ? theme.colors.warning
          : tone === "danger"
            ? theme.colors.error
            : theme.colors.mutedForeground;

  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={color}>●</text>
      <text fg={theme.colors.foreground}>{label}</text>
    </box>
  );
};

export const Well = ({
  children,
  bordered = false,
}: {
  children: ReactNode;
  bordered?: boolean;
}) => {
  const theme = useTheme();

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      padding={1}
      backgroundColor={theme.colors.muted}
      {...(bordered
        ? {
            border: true as const,
            borderColor: theme.colors.border,
            borderStyle: theme.border.style,
          }
        : {})}
    >
      {children}
    </box>
  );
};
