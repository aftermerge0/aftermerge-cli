import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useAnimation } from "@/hooks/use-animation";
import { useTheme } from "@/hooks/use-theme";
import { AFTERMERGE_COLORS } from "@/lib/terminal-themes/aftermerge";
import { formatElapsed } from "@/scan-progress";
import { EmptyState, ErrorLine, ViewHeader, Well } from "@/ui/chrome";

export type AuthStatus = "signed-out" | "waiting" | "signed-in" | "error";

export interface AuthUser {
  readonly login: string;
  readonly org?: string;
}

export interface AuthDevice {
  readonly userCode: string;
  readonly verificationUrl: string;
}

export interface AuthViewProps {
  status?: AuthStatus;
  user?: AuthUser;
  device?: AuthDevice;
  error?: string;
  waitingSince?: number;
  checking?: boolean;
}

export const SAMPLE_DEVICE: AuthDevice = {
  userCode: "WD4K-9F2Q",
  verificationUrl: "https://www.aftermerge.dev/device",
};

const formatUser = (user: AuthUser): string =>
  user.org ? `${user.login}@${user.org}` : user.login;

export const AuthView = ({
  status,
  user,
  device,
  error,
  waitingSince,
  checking = false,
}: AuthViewProps) => {
  const theme = useTheme();
  const resolved: AuthStatus = status ?? (user ? "signed-in" : "signed-out");
  useAnimation({
    intervalMs: 1000,
    isActive: resolved === "waiting" && waitingSince !== undefined,
  });
  const waited =
    resolved === "waiting" && waitingSince !== undefined
      ? formatElapsed(Date.now() - waitingSince)
      : undefined;

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader kicker="auth" title="This machine" />
      {checking ? (
        <box marginTop={1}>
          <Spinner
            type="line"
            label="checking session"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : null}
      {!checking && resolved === "signed-out" ? (
        <EmptyState>sign in to continue</EmptyState>
      ) : null}
      {!checking && resolved === "signed-in" && user ? (
        <box flexDirection="column" gap={1} marginTop={1}>
          <Badge variant="success" bordered={false} bold>
            signed in
          </Badge>
          <text fg={theme.colors.foreground}>{formatUser(user)}</text>
        </box>
      ) : null}
      {!checking && resolved === "waiting" && device ? (
        <box flexDirection="column" marginTop={1} gap={1}>
          <Well bordered>
            <text fg={AFTERMERGE_COLORS.accent}>
              <b>{device.userCode}</b>
            </text>
            <text fg={theme.colors.mutedForeground}>
              {device.verificationUrl}
            </text>
          </Well>
          <Spinner
            type="line"
            label={waited ? `waiting for browser · ${waited}` : "waiting for browser"}
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : null}
      {!checking && resolved === "waiting" && !device ? (
        <box marginTop={1}>
          <Spinner
            type="line"
            label="starting sign-in"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : null}
      {resolved === "error" ? (
        <box marginTop={1}>
          <ErrorLine>{error ?? "sign-in failed. device code expired."}</ErrorLine>
        </box>
      ) : null}
      <box flexGrow={1} />
      <box flexShrink={0}>
        <text fg={theme.colors.mutedForeground}>l sign in · o sign out</text>
      </box>
    </box>
  );
};
