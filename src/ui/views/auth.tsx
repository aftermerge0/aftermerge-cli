import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/use-theme";
import { AFTERMERGE_COLORS } from "@/lib/terminal-themes/aftermerge";
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
}: AuthViewProps) => {
  const theme = useTheme();
  const resolved: AuthStatus = status ?? (user ? "signed-in" : "signed-out");

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader kicker="auth" title="This machine" />
      {resolved === "signed-out" ? (
        <EmptyState>sign in</EmptyState>
      ) : null}
      {resolved === "signed-in" && user ? (
        <box flexDirection="column" gap={1} marginTop={1}>
          <Badge variant="success" bordered={false} bold>
            signed in
          </Badge>
          <text fg={theme.colors.foreground}>{formatUser(user)}</text>
        </box>
      ) : null}
      {resolved === "waiting" && device ? (
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
            label="waiting for browser"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : null}
      {resolved === "waiting" && !device ? (
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
