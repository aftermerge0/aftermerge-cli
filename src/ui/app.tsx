import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useState } from "react";

import { AppShell } from "@/components/ui/app-shell";
import { CommandPalette, type Command } from "@/components/ui/command-palette";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { useTheme } from "@/hooks/use-theme";
import { aftermergeTheme } from "@/lib/terminal-themes/aftermerge";
import { useAppData } from "@/ui/use-app-data";
import { AuthView } from "@/ui/views/auth";
import { ChatView } from "@/ui/views/chat";
import { FindingsView } from "@/ui/views/findings";
import { ReposView } from "@/ui/views/repos";
import { ScanView } from "@/ui/views/scan";
import { VIEW_IDS, type ParsedRoute, type ViewId } from "@/ui/route";

const TABS: { id: ViewId; label: string }[] = [
  { id: "scan", label: "Scan" },
  { id: "repos", label: "Repos" },
  { id: "findings", label: "Findings" },
  { id: "chat", label: "Chat" },
  { id: "auth", label: "Auth" },
];

export interface AppProps {
  initialRoute: ParsedRoute;
  onQuit?: () => void;
}

const formatUser = (
  user: { login: string; org?: string } | undefined,
): string => {
  if (!user) {
    return "not signed in";
  }
  return user.org ? `${user.login}@${user.org}` : user.login;
};

const footerFor = (view: ViewId, capturingText: boolean): string => {
  if (capturingText) {
    return "enter send · esc palette · ctrl+c quit";
  }
  if (view === "scan") {
    return "s scan · 1-5 views · / palette · q quit";
  }
  if (view === "findings") {
    return "↑↓ detail · 1-5 views · / palette · q quit";
  }
  if (view === "auth") {
    return "l sign in · o sign out · 1-5 views · q quit";
  }
  return "1-5 views · / palette · q quit";
};

const Shell = ({ initialRoute, onQuit }: AppProps) => {
  const theme = useTheme();
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [view, setView] = useState<ViewId>(initialRoute.view);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const data = useAppData(initialRoute);

  const quit = useCallback(() => {
    data.interruptAll();
    if (onQuit) {
      onQuit();
      return;
    }
    renderer.destroy();
    process.exit(0);
  }, [data, onQuit, renderer]);

  const capturingText = view === "chat" && !paletteOpen;

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      quit();
      return;
    }

    if (paletteOpen) {
      if (key.name === "escape") {
        setPaletteOpen(false);
      }
      return;
    }

    if (key.name === "escape" && capturingText) {
      setPaletteOpen(true);
      return;
    }

    if (key.name === "/" || (key.ctrl && key.name === "k")) {
      setPaletteOpen(true);
      return;
    }

    if (key.name === "q" && !capturingText) {
      quit();
      return;
    }

    if (!capturingText && key.name === "s") {
      setView("scan");
      data.startScan();
      return;
    }

    if (!capturingText && key.name === "l") {
      setView("auth");
      data.startLogin();
      return;
    }

    if (!capturingText && key.name === "o") {
      data.logout();
      return;
    }

    if (view === "findings" && data.scanFindings.length > 0) {
      if (key.name === "up") {
        data.setSelectedFinding(Math.max(0, data.selectedFinding - 1));
        return;
      }
      if (key.name === "down") {
        data.setSelectedFinding(
          Math.min(data.scanFindings.length - 1, data.selectedFinding + 1),
        );
        return;
      }
    }

    const digit = Number.parseInt(key.name, 10);
    if (
      !capturingText &&
      key.name.length === 1 &&
      digit >= 1 &&
      digit <= TABS.length
    ) {
      const next = TABS[digit - 1];
      if (next) {
        setView(next.id);
      }
      return;
    }

    const idx = VIEW_IDS.indexOf(view);
    if (capturingText) {
      return;
    }
    if (key.name === "left" && idx > 0) {
      const next = TABS[idx - 1];
      if (next) {
        setView(next.id);
      }
    } else if (key.name === "right" && idx < TABS.length - 1) {
      const next = TABS[idx + 1];
      if (next) {
        setView(next.id);
      }
    }
  });

  const commands: Command[] = [
    ...TABS.map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      shortcut: String(i + 1),
      group: "views",
      onSelect: () => setView(tab.id),
    })),
    {
      id: "scan-now",
      label: "Scan this repo",
      shortcut: "s",
      group: "actions",
      onSelect: () => {
        setView("scan");
        data.startScan();
      },
    },
    {
      id: "sign-in",
      label: "Sign in",
      shortcut: "l",
      group: "actions",
      onSelect: () => {
        setView("auth");
        data.startLogin();
      },
    },
    {
      id: "sign-out",
      label: "Sign out",
      shortcut: "o",
      group: "actions",
      onSelect: data.logout,
    },
    {
      id: "quit",
      label: "Quit",
      shortcut: "q",
      group: "app",
      onSelect: quit,
    },
  ];

  const paletteWidth = Math.min(52, Math.max(36, width - 8));

  return (
    <AppShell>
      <box
        flexDirection="column"
        flexGrow={1}
        width="100%"
        height="100%"
        backgroundColor={theme.colors.background}
        borderStyle="single"
        borderColor={theme.colors.border}
      >
        <box
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          border={["bottom"]}
          borderColor={theme.colors.accent}
          flexShrink={0}
        >
          <text fg={theme.colors.accent}>
            <b>AFTERMERGE</b>
          </text>
          <box flexGrow={1} />
          <text fg={theme.colors.mutedForeground}>{formatUser(data.user)}</text>
        </box>

        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          paddingRight={1}
          border={["bottom"]}
          borderColor={theme.colors.border}
          flexShrink={0}
        >
          {TABS.map((tab, i) => {
            const active = tab.id === view;
            return (
              <box key={tab.id} flexDirection="row" gap={1}>
                <text fg={theme.colors.mutedForeground}>{String(i + 1)}</text>
                <text
                  fg={
                    active ? theme.colors.accent : theme.colors.mutedForeground
                  }
                >
                  {active ? <b>{tab.label}</b> : tab.label}
                </text>
              </box>
            );
          })}
        </box>

        <box
          flexGrow={1}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          overflow="hidden"
        >
          {view === "scan" ? (
            <ScanView
              pr={data.pr}
              status={data.scanStatus}
              progress={data.scanProgress}
              findings={data.scanFindings}
              error={data.scanError}
              hint="s to scan this repo"
            />
          ) : null}
          {view === "repos" ? (
            <ReposView
              repos={data.repos}
              loading={data.reposLoading}
              error={data.reposError}
              hint="connect from the dashboard, or scan this checkout"
            />
          ) : null}
          {view === "findings" ? (
            <FindingsView
              findings={data.scanFindings}
              loading={data.findingsLoading}
              error={data.findingsError}
              selected={data.selectedFinding}
              detail={data.selectedDetail}
            />
          ) : null}
          {view === "chat" ? (
            <ChatView
              messages={data.chatMessages}
              input={data.chatInput}
              onInputChange={data.setChatInput}
              onSubmit={data.submitChat}
              busy={data.chatBusy}
              error={data.chatError}
              inputEnabled={!paletteOpen}
            />
          ) : null}
          {view === "auth" ? (
            <AuthView
              user={data.user}
              status={data.authStatus}
              device={data.device}
              error={data.authError}
            />
          ) : null}
        </box>

        <box
          paddingLeft={1}
          paddingRight={1}
          border={["top"]}
          borderColor={theme.colors.border}
          flexShrink={0}
        >
          <text fg={theme.colors.mutedForeground}>
            {footerFor(view, capturingText)}
          </text>
        </box>
      </box>

      {paletteOpen ? (
        <box
          position="absolute"
          left={Math.max(2, Math.floor((width - paletteWidth) / 2))}
          top={3}
          width={paletteWidth}
          zIndex={100}
        >
          <CommandPalette
            isOpen
            onClose={() => setPaletteOpen(false)}
            placeholder="jump or run"
            commands={commands}
          />
        </box>
      ) : null}
    </AppShell>
  );
};

export const App = (props: AppProps) => (
  <ThemeProvider theme={aftermergeTheme}>
    <Shell {...props} />
  </ThemeProvider>
);
